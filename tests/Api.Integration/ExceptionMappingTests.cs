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

        // The next append loses the optimistic-concurrency check, as a racing or
        // double-submitted write to the same stream would.
        store.ConflictOnNextAppend = true;
        var resp = await client.PatchAsync($"/notes/{noteId}/title",
            new StringContent("{\"title\":\"Renamed\"}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
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
}
