using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// RYW-3a end-to-end through the HTTP layer: the action flows are async (the projector — driven
// in-process by SyncProjectingEventStore — is the sole writer of the action read models, no inline
// projection write). Each action write returns its write token in the `X-Consistency-Token`
// response header; the actions read (`GET /notes/{id}/actions`) carrying that token in
// `If-Consistent-With` waits on the gate until the projector has applied the write before
// answering. Mirrors NoteReadYourWritesTests (RYW-2), now generalised to the action read endpoint.
public sealed class ActionItemReadYourWritesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task AddAction_ReturnsConsistencyTokenHeader_ForItsStream()
    {
        var noteId = await CreateNoteAsync();

        var (actionId, addResp) = await AddActionAsync(noteId, "Ship it");
        var token = Assert.Single(addResp.Headers.GetValues("X-Consistency-Token"));
        var (stream, version) = ParseToken(token);

        Assert.Equal($"action#{actionId}", stream);
        Assert.True(version >= 1, $"expected a positive version, got {version}");
    }

    [Fact]
    public async Task CompleteAction_ReturnsConsistencyTokenHeader_AtNextVersion()
    {
        var noteId = await CreateNoteAsync();
        var (actionId, addResp) = await AddActionAsync(noteId, "Ship it");
        var (_, addVersion) = ParseToken(addResp.Headers.GetValues("X-Consistency-Token").Single());

        var completeResp = await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        completeResp.EnsureSuccessStatusCode();

        var token = Assert.Single(completeResp.Headers.GetValues("X-Consistency-Token"));
        var (stream, version) = ParseToken(token);
        Assert.Equal($"action#{actionId}", stream);
        Assert.Equal(addVersion + 1, version);
    }

    [Fact]
    public async Task GetActions_WithConsistencyToken_SeesTheNewAction()
    {
        var noteId = await CreateNoteAsync();
        var (actionId, addResp) = await AddActionAsync(noteId, "Read your writes");
        var token = Assert.Single(addResp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, $"/notes/{noteId}/actions");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        // The gate found the projection already caught up (sync decorator), so not stale.
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var action = (await getResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("actions").EnumerateArray()
            .Single(a => a.GetProperty("actionId").GetString() == actionId);
        Assert.Equal("Read your writes", action.GetProperty("description").GetString());
    }

    [Fact]
    public async Task GetActions_WithUnreachedToken_ReturnsStaleWithinBound()
    {
        var noteId = await CreateNoteAsync();
        var (actionId, _) = await AddActionAsync(noteId, "Ship it");

        // A version the projector will never reach → the gate waits the bound then serves stale.
        var req = new HttpRequestMessage(HttpMethod.Get, $"/notes/{noteId}/actions");
        req.Headers.Add("If-Consistent-With", $"action#{actionId}@9999");
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.Equal("stale", Assert.Single(getResp.Headers.GetValues("X-Consistency")));
    }

    private static (string Stream, long Version) ParseToken(string token)
    {
        var at = token.LastIndexOf('@');
        return (token[..at], long.Parse(token[(at + 1)..]));
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private async Task<(string ActionId, HttpResponseMessage Response)> AddActionAsync(string noteId, string description)
    {
        var resp = await _client.PostAsync($"/notes/{noteId}/actions",
            new StringContent($"{{\"description\":\"{description}\"}}", Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        var actionId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("actionId").GetString()!;
        return (actionId, resp);
    }
}
