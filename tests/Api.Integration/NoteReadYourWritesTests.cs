using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// RYW-2 end-to-end through the HTTP layer: the note flows are async (the projector — driven
// in-process by SyncProjectingEventStore — is the sole writer of the note read models, no inline
// projection write). Each note write returns its write token in the `X-Consistency-Token` response
// header; a note read carrying that token in `If-Consistent-With` waits on the gate until the
// projector has applied the write before answering. Mirrors TodoReadYourWritesTests (RYW-1), now
// generalised to the note read endpoints (`GET /notes/{id}`, `GET /notes/cards`).
public sealed class NoteReadYourWritesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task CreateNote_ReturnsConsistencyTokenHeader_ForItsStream()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();

        var noteId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        var token = Assert.Single(resp.Headers.GetValues("X-Consistency-Token"));
        var (stream, version) = ParseToken(token);
        Assert.Equal($"note#{noteId}", stream);
        // Create appends NoteCreated + NoteAssignedToWorkspace, so a fresh stream lands at v2.
        Assert.True(version >= 1, $"expected a positive version, got {version}");
    }

    [Fact]
    public async Task RenameNote_ReturnsConsistencyTokenHeader_AtNextVersion()
    {
        var (noteId, createToken) = await CreateNoteAsync();
        var (_, createVersion) = ParseToken(createToken);

        var renameResp = await PatchAsync($"/notes/{noteId}/title", "{\"title\":\"Q3 plan\"}");
        renameResp.EnsureSuccessStatusCode();

        var token = Assert.Single(renameResp.Headers.GetValues("X-Consistency-Token"));
        var (stream, version) = ParseToken(token);
        Assert.Equal($"note#{noteId}", stream);
        // Rename appends exactly one event on top of the create batch.
        Assert.Equal(createVersion + 1, version);
    }

    private static (string Stream, long Version) ParseToken(string token)
    {
        var at = token.LastIndexOf('@');
        return (token[..at], long.Parse(token[(at + 1)..]));
    }

    [Fact]
    public async Task GetNoteDetail_WithConsistencyToken_SeesTheRename()
    {
        var (noteId, _) = await CreateNoteAsync();
        var renameResp = await PatchAsync($"/notes/{noteId}/title", "{\"title\":\"Renamed via RYW\"}");
        var token = Assert.Single(renameResp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, $"/notes/{noteId}");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        // The gate found the projection already caught up (sync decorator), so not stale.
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var detail = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Renamed via RYW", detail.GetProperty("title").GetString());
    }

    [Fact]
    public async Task GetNoteCards_WithConsistencyToken_SeesTheNewTitle()
    {
        var (noteId, _) = await CreateNoteAsync();
        var renameResp = await PatchAsync($"/notes/{noteId}/title", "{\"title\":\"Card title via RYW\"}");
        var token = Assert.Single(renameResp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/notes/cards");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var card = (await getResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("cards").EnumerateArray()
            .First(c => c.GetProperty("noteId").GetString() == noteId);
        Assert.Equal("Card title via RYW", card.GetProperty("title").GetString());
    }

    // The cross-aggregate row: the note card is written by BOTH note events (now via the projector)
    // and action events (still inline). With full-item writes the two writers would clobber each
    // other's fields; the field-level card writes must let a note rename and an action edit coexist.
    [Fact]
    public async Task CardSurvivesInterleavedNoteAndActionWrites_NoClobber()
    {
        var (noteId, _) = await CreateNoteAsync();
        var actionId = await AddActionAsync(noteId, "Ship it");

        // Note-owned field write (rename) and action-owned field write (complete) against one card.
        await PatchAsync($"/notes/{noteId}/title", "{\"title\":\"Release plan\"}");
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        await PatchAsync($"/notes/{noteId}/date", "{\"date\":\"2026-07-01\"}");

        var card = await GetCardAsync(noteId);
        // Note fields survived the action write...
        Assert.Equal("Release plan", card.GetProperty("title").GetString());
        Assert.Equal("2026-07-01", card.GetProperty("date").GetString());
        // ...and the action write survived the note writes (completed action no longer "open").
        Assert.Empty(card.GetProperty("openActions").EnumerateArray());
    }

    private async Task<(string NoteId, string Token)> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        var noteId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        var token = resp.Headers.GetValues("X-Consistency-Token").Single();
        return (noteId, token);
    }

    private async Task<string> AddActionAsync(string noteId, string description)
    {
        var resp = await _client.PostAsync($"/notes/{noteId}/actions",
            new StringContent($"{{\"description\":\"{description}\"}}", Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("actionId").GetString()!;
    }

    private Task<HttpResponseMessage> PatchAsync(string url, string json) =>
        _client.PatchAsync(url, new StringContent(json, Encoding.UTF8, "application/json"));

    private async Task<JsonElement> GetCardAsync(string noteId)
    {
        var body = await _client.GetFromJsonAsync<JsonElement>("/notes/cards");
        return body.GetProperty("cards").EnumerateArray()
            .First(c => c.GetProperty("noteId").GetString() == noteId);
    }
}
