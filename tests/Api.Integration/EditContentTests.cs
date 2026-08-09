using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Domain.Notes;

namespace Api.Integration;

public sealed class EditContentTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PutContent_ExistingNote_Returns204()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.PutAsync($"/notes/{noteId}/content",
            new StringContent("{\"content\":\"Today we discussed the roadmap.\"}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    [Fact]
    public async Task PutContent_NonExistentNote_Returns404()
    {
        var resp = await _client.PutAsync($"/notes/{Guid.NewGuid()}/content",
            new StringContent("{\"content\":\"Some content\"}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task PutContent_ThenGetNote_ReturnsUpdatedContentAndBumpsLastModifiedAt()
    {
        var noteId = await CreateNoteAsync();
        var before = (await (await _client.GetAsync($"/notes/{noteId}"))
            .Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("lastModifiedAt").GetString();

        await _client.PutAsync($"/notes/{noteId}/content",
            new StringContent("{\"content\":\"Sprint retrospective notes.\"}", Encoding.UTF8, "application/json"));

        var resp = await _client.GetAsync($"/notes/{noteId}");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Sprint retrospective notes.", body.GetProperty("content").GetString());
        var after = body.GetProperty("lastModifiedAt").GetString();
        Assert.NotEqual(before, after);
    }

    [Fact]
    public async Task PutContent_ClearingToEmpty_PersistsEmptyAndReturnsItOnGet()
    {
        var noteId = await CreateNoteAsync();
        await _client.PutAsync($"/notes/{noteId}/content",
            new StringContent("{\"content\":\"original content\"}", Encoding.UTF8, "application/json"));

        await _client.PutAsync($"/notes/{noteId}/content",
            new StringContent("{\"content\":\"\"}", Encoding.UTF8, "application/json"));

        var resp = await _client.GetAsync($"/notes/{noteId}");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("", body.GetProperty("content").GetString());
    }

    // BUG-47: a content edit whose declared base hash no longer matches the current content (the
    // client edited a stale/empty view) is a terminal conflict → 409 `stale_content`, and the real
    // content is NOT overwritten.
    [Fact]
    public async Task PutContent_StaleBaseHash_Returns409StaleContentAndDoesNotOverwrite()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "The full original meeting note.");

        // The client thought the note was empty (stale/empty projection) and retyped a fragment.
        var resp = await PutContentAsync(noteId, "fragment the user retyped",
            expectedBaseContentHash: NoteContentHash.Compute(""));

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var error = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString();
        Assert.Equal("stale_content", error);

        var body = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("The full original meeting note.", body.GetProperty("content").GetString());
    }

    // A legitimate edit carries the hash of the content the user actually saw → accepted.
    [Fact]
    public async Task PutContent_MatchingBaseHash_Returns204AndUpdates()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "The full original meeting note.");

        var resp = await PutContentAsync(noteId, "The full original meeting note. Plus a new line.",
            expectedBaseContentHash: NoteContentHash.Compute("The full original meeting note."));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var body = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("The full original meeting note. Plus a new line.", body.GetProperty("content").GetString());
    }

    // A deliberate delete-all still works when the base hash matches what the user saw.
    [Fact]
    public async Task PutContent_MatchingBaseHash_DeleteAll_Returns204()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "The full original meeting note.");

        var resp = await PutContentAsync(noteId, "",
            expectedBaseContentHash: NoteContentHash.Compute("The full original meeting note."));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var body = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("", body.GetProperty("content").GetString());
    }

    // Backward compatibility: a request without a base hash skips the guard (unchanged behaviour).
    [Fact]
    public async Task PutContent_NoBaseHash_OverwritesAsBefore()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "The full original meeting note.");

        var resp = await PutContentAsync(noteId, "fragment");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var body = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("fragment", body.GetProperty("content").GetString());
    }

    // BUG-59: a note deleted while its editor is open makes every further write 404, and the client
    // routed that to a retriable "try again" toast — prod shows six rejected writes over 31 minutes.
    // The 404 now carries a discriminating body so the client can tell deletion apart from the OTHER
    // bare 404s on this path, and stop inviting a retry that cannot succeed.
    [Fact]
    public async Task PutContent_DeletedNote_Returns404NoteNotFound()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "Text written before the note was deleted.");
        await _client.DeleteAsync($"/notes/{noteId}");

        var resp = await PutContentAsync(noteId, "Text typed after the delete landed.");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        var error = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString();
        Assert.Equal("note_not_found", error);
    }

    // The discriminator must mean "gone from the event stream" and NOTHING else. A note that exists
    // but belongs to someone else is deliberately answered 404 to avoid leaking existence — telling
    // that caller "this note was deleted" would be false, and would make {bare 404, note_not_found}
    // an oracle for "exists but isn't yours". Review of the first attempt found exactly this,
    // because the event-stream owner check threw the same exception as a missing note.
    [Fact]
    public async Task PutContent_NoteOwnedByAnotherUser_Returns404WithoutTheNoteNotFoundCode()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "The owner's meeting note.");

        var intruder = factory.CreateClientAsOtherUser();
        var resp = await intruder.PutAsync($"/notes/{noteId}/content",
            JsonContent.Create(new { content = "written by someone else" }));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.DoesNotContain("note_not_found", await resp.Content.ReadAsStringAsync());

        // ...and the owner's content is untouched.
        var body = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("The owner's meeting note.", body.GetProperty("content").GetString());
    }

    private Task<HttpResponseMessage> PutContentAsync(string noteId, string content, string? expectedBaseContentHash = null) =>
        _client.PutAsync($"/notes/{noteId}/content",
            JsonContent.Create(new { content, expectedBaseContentHash }));

    private async Task<string> CreateNoteAsync()
    {
        var create = await _client.PostAsync("/notes", null);
        return (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }
}
