using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class ApiIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetHealth_Returns200WithStatusOkAndDynamoOk()
    {
        var resp = await _client.GetAsync("/health");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.Equal("ok", body.GetProperty("dynamo").GetProperty("status").GetString());
    }

    [Fact]
    public async Task PostNotes_Returns201WithNoteId()
    {
        var resp = await _client.PostAsync("/notes", null);

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(Guid.TryParse(body.GetProperty("noteId").GetString(), out _));
    }

    [Fact]
    public async Task PostNotes_WithDuplicateNoteId_Returns409()
    {
        var create = await _client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = body.GetProperty("noteId").GetString();

        var json = new StringContent($"{{\"noteId\":\"{noteId}\"}}", Encoding.UTF8, "application/json");
        var resp = await _client.PostAsync("/notes", json);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task PatchNoteTitle_ExistingNote_Returns200()
    {
        var create = await _client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = body.GetProperty("noteId").GetString();

        var patch = new StringContent("{\"title\":\"My Note\"}", Encoding.UTF8, "application/json");
        var resp = await _client.PatchAsync($"/notes/{noteId}/title", patch);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task PatchNoteTitle_NonExistentNote_Returns404()
    {
        var patch = new StringContent("{\"title\":\"Ghost\"}", Encoding.UTF8, "application/json");
        var resp = await _client.PatchAsync($"/notes/{Guid.NewGuid()}/title", patch);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task GetNotes_ReturnsItemsContainingCreatedNote()
    {
        var create = await _client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var createdNoteId = body.GetProperty("noteId").GetString();

        var resp = await _client.GetAsync("/notes");

        resp.EnsureSuccessStatusCode();
        var listBody = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = listBody.GetProperty("items").EnumerateArray().ToList();
        var match = Assert.Single(items, i => i.GetProperty("noteId").GetString() == createdNoteId);
        Assert.True(match.TryGetProperty("lastModifiedAt", out _), "item should include lastModifiedAt");
    }

    [Fact]
    public async Task GetNotes_ReturnsItemsOrderedByLastModifiedAtDescending()
    {
        var first = await _client.PostAsync("/notes", null);
        var firstId = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        var second = await _client.PostAsync("/notes", null);
        var secondId = (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        // Rename the first note so it has a later lastModifiedAt than the second
        await _client.PatchAsync($"/notes/{firstId}/title",
            new StringContent("{\"title\":\"updated\"}", Encoding.UTF8, "application/json"));

        var resp = await _client.GetAsync("/notes");
        var items = (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();

        var firstIdx = items.FindIndex(i => i.GetProperty("noteId").GetString() == firstId);
        var secondIdx = items.FindIndex(i => i.GetProperty("noteId").GetString() == secondId);
        Assert.True(firstIdx < secondIdx, "renamed note should appear before older note");
    }


    [Fact]
    public async Task GetNoteDetails_ReturnsTheNoteWithTheTitle()
    {
        var createResponse = await _client.PostAsync("/notes", null);
        var createResponseBody = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var createdNoteId = createResponseBody.GetProperty("noteId").GetString();

        await _client.PatchAsync($"/notes/{createdNoteId}/title",
            new StringContent("{\"title\":\"Correct Title\"}", Encoding.UTF8, "application/json"));

        var resp = await _client.GetAsync($"/notes/{createdNoteId}");

        resp.EnsureSuccessStatusCode();
        var listBody = await resp.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(createdNoteId, listBody.GetProperty("noteId").GetString());
        Assert.Equal("Correct Title", listBody.GetProperty("title").GetString());
        Assert.True(listBody.TryGetProperty("content", out _), "response must include content");
        Assert.True(listBody.TryGetProperty("createdAt", out _), "response must include createdAt");
    }

    [Fact]
    public async Task WhenNoNoteExists_GetNoteDetails_ReturnsNotFound()
    {
        var randomNoteId = Guid.NewGuid().ToString();

        await _client.PatchAsync($"/notes/{randomNoteId}/title",
            new StringContent("{\"title\":\"Correct Title\"}", Encoding.UTF8, "application/json"));

        var resp = await _client.GetAsync($"/notes/{randomNoteId}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task WhenMoreThanOneNoteExists_GetNoteDetails_ReturnsTheRequestedNote()
    {
        var first = await _client.PostAsync("/notes", null);
        var firstNoteId = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        var second = await _client.PostAsync("/notes", null);
        var secondNoteId = (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        await _client.PatchAsync($"/notes/{firstNoteId}/title",
            new StringContent("{\"title\":\"First Title\"}", Encoding.UTF8, "application/json"));
        await _client.PatchAsync($"/notes/{secondNoteId}/title",
            new StringContent("{\"title\":\"Second Title\"}", Encoding.UTF8, "application/json"));

        var resp = await _client.GetAsync($"/notes/{firstNoteId}");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(firstNoteId, body.GetProperty("noteId").GetString());
        Assert.Equal("First Title", body.GetProperty("title").GetString());
    }

    [Fact]
    public async Task DeleteNote_ExistingNote_Returns204()
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        var resp = await _client.DeleteAsync($"/notes/{noteId}");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteNote_NonExistentNote_Returns404()
    {
        var resp = await _client.DeleteAsync($"/notes/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteNote_RemovedFromList()
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        await _client.DeleteAsync($"/notes/{noteId}");

        var resp = await _client.GetAsync("/notes");
        var items = (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();
        Assert.DoesNotContain(items, i => i.GetProperty("noteId").GetString() == noteId);
    }

    [Fact]
    public async Task DeleteNote_GetNoteReturns404()
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        await _client.DeleteAsync($"/notes/{noteId}");

        var resp = await _client.GetAsync($"/notes/{noteId}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteNote_AlreadyDeleted_Returns404()
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        await _client.DeleteAsync($"/notes/{noteId}");
        var resp = await _client.DeleteAsync($"/notes/{noteId}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
