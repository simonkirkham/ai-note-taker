using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// BUG-4: a concurrency conflict on a note write surfaced as an unhandled 500.
// BUG-5: renaming/editing/dating a note that no longer exists in the stream
//        (but still shows in an eventually-consistent projection) surfaced as
//        an unhandled 500 instead of a clean 404.
public sealed class ExceptionMappingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task ConcurrencyConflict_OnNoteWrite_Returns409NotUnhandled500()
    {
        var store = new ConflictingEventStore();
        var custom = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(store);
        }));
        var client = custom.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteId = await CreateNoteAsync(client);

        // Every append loses the optimistic-concurrency check, so the handler's bounded
        // retry (BUG-17) exhausts and the persistent conflict still surfaces as a 409
        // (rather than an unhandled 500). A *single* benign race that the retry resolves
        // is covered by ConcurrencyConflict_OnTagAdd_RetriesAndPersists below.
        store.ConflictsRemaining = int.MaxValue;
        var resp = await client.PatchAsync($"/notes/{noteId}/title",
            new StringContent("{\"title\":\"Renamed\"}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    // BUG-17: a single benign concurrency race on a tag add must NOT drop the write.
    // The handler re-reads the stream, re-runs the pure command, and re-appends at the
    // fresh version, so the tag persists and a subsequent remove succeeds (no 404 bounce).
    [Fact]
    public async Task ConcurrencyConflict_OnTagAdd_RetriesAndPersists()
    {
        var store = new ConflictingEventStore();
        var custom = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(store);
        }));
        var client = custom.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteId = await CreateNoteAsync(client);

        // The first append attempt loses the race (as the second of two concurrent tag
        // adds would); the handler must retry and succeed rather than drop the write.
        store.ConflictsRemaining = 1;
        var add = await PostTagAsync(client, noteId, "1:1s");
        Assert.Equal(HttpStatusCode.NoContent, add.StatusCode);

        // The tag is genuinely on the stream — it appears in GET /notes/{id}...
        var tags = await GetTagsAsync(client, noteId);
        Assert.Contains("1:1s", tags);

        // ...and removing it succeeds (no 404 bounce-back from a phantom tag).
        var remove = await client.DeleteAsync($"/notes/{noteId}/tags/1%3A1s");
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
    }

    // BUG-17: two adds of *different* tags racing — the loser's append conflicts once,
    // the handler retries on the fresh version, and BOTH tags end up persisted.
    [Fact]
    public async Task ConcurrencyConflict_OnSecondOfTwoTagAdds_BothPersist()
    {
        var store = new ConflictingEventStore();
        var custom = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(store);
        }));
        var client = custom.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteId = await CreateNoteAsync(client);

        var first = await PostTagAsync(client, noteId, "1:1s");
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);

        // The second add's first append loses the race; the retry re-reads the stream
        // (now carrying the first tag) and re-appends the second tag at the fresh version.
        store.ConflictsRemaining = 1;
        var second = await PostTagAsync(client, noteId, "Bill");
        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);

        var tags = await GetTagsAsync(client, noteId);
        Assert.Contains("1:1s", tags);
        Assert.Contains("Bill", tags);
    }

    [Theory]
    [InlineData("PATCH", "title", "{\"title\":\"Renamed after delete\"}")]
    [InlineData("PUT", "content", "{\"content\":\"Edited after delete\"}")]
    [InlineData("PATCH", "date", "{\"date\":\"2026-01-01\"}")]
    public async Task WriteToDeletedNote_WithStaleProjection_Returns404NotUnhandled500(
        string method, string segment, string body)
    {
        var client = _factory.CreateClient();
        var noteId = await CreateNoteAsync(client);
        var id = new NoteId(Guid.Parse(noteId));

        // Capture the live projection, then delete the note (removes stream + projection).
        var detailStore = _factory.Services.GetRequiredService<INoteDetailStore>();
        var staleView = await detailStore.GetAsync(id);
        Assert.NotNull(staleView);

        var del = await client.DeleteAsync($"/notes/{noteId}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        // Reintroduce the projection to simulate the eventual-consistency window
        // where the read model still shows a note whose stream is already deleted.
        await detailStore.UpsertAsync(staleView!);

        var req = new HttpRequestMessage(new HttpMethod(method), $"/notes/{noteId}/{segment}")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        var resp = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private static async Task<string> CreateNoteAsync(HttpClient client)
    {
        var create = await client.PostAsync("/notes", null);
        return (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private static Task<HttpResponseMessage> PostTagAsync(HttpClient client, string noteId, string tag) =>
        client.PostAsync($"/notes/{noteId}/tags",
            new StringContent($"{{\"tag\":\"{tag}\"}}", Encoding.UTF8, "application/json"));

    private static async Task<List<string?>> GetTagsAsync(HttpClient client, string noteId)
    {
        var get = await client.GetAsync($"/notes/{noteId}");
        get.EnsureSuccessStatusCode();
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
    }
}
