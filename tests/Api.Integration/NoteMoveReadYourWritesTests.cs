using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// BUG-45: the note-move writes (move-to-workspace, move-to-folder, unfile) are the same defect class
// as the BUG-44 delete — the frontend optimistically drops/patches the card then refetches the cards
// list, so each move must surface an `X-Consistency-Token` for the client to gate that refetch on the
// projector applying the move. Otherwise a moved note reappears in the source workspace's list
// (move-to-workspace) or the folder placement flickers. Mirrors NoteReadYourWritesTests.
public sealed class NoteMoveReadYourWritesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task MoveNoteToWorkspace_ReturnsConsistencyTokenHeader_ForItsStream()
    {
        var (noteId, createToken) = await CreateNoteAsync();
        var (_, createVersion) = ParseToken(createToken);
        var workspaceId = await CreateWorkspaceAsync("Work");

        var moveResp = await PutAsync($"/notes/{noteId}/workspace", $"{{\"workspaceId\":\"{workspaceId}\"}}");
        moveResp.EnsureSuccessStatusCode();

        var token = Assert.Single(moveResp.Headers.GetValues("X-Consistency-Token"));
        var (stream, version) = ParseToken(token);
        Assert.Equal($"note#{noteId}", stream);
        // Moving an unfiled note to another workspace appends one NoteAssignedToWorkspace event.
        Assert.Equal(createVersion + 1, version);
    }

    // The BUG-45 symptom proper: a cards read (in the source/default workspace) carrying the move's
    // token must NOT list the note — the gate waits until the projector has moved it out.
    [Fact]
    public async Task GetNoteCards_WithMoveToWorkspaceToken_ExcludesTheMovedNote()
    {
        var (noteId, _) = await CreateNoteAsync();
        var workspaceId = await CreateWorkspaceAsync("Work");
        var moveResp = await PutAsync($"/notes/{noteId}/workspace", $"{{\"workspaceId\":\"{workspaceId}\"}}");
        var token = Assert.Single(moveResp.Headers.GetValues("X-Consistency-Token"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/notes/cards");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var cards = (await getResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("cards").EnumerateArray();
        Assert.DoesNotContain(cards, c => c.GetProperty("noteId").GetString() == noteId);
    }

    [Fact]
    public async Task MoveNoteToFolder_ReturnsConsistencyTokenHeader_AtNextVersion()
    {
        var (noteId, createToken) = await CreateNoteAsync();
        var (_, createVersion) = ParseToken(createToken);
        var folderId = await CreateFolderAsync("People");

        var moveResp = await PutAsync($"/notes/{noteId}/folder", $"{{\"folderId\":\"{folderId}\"}}");
        moveResp.EnsureSuccessStatusCode();

        var token = Assert.Single(moveResp.Headers.GetValues("X-Consistency-Token"));
        var (stream, version) = ParseToken(token);
        Assert.Equal($"note#{noteId}", stream);
        Assert.Equal(createVersion + 1, version);
    }

    [Fact]
    public async Task UnfileNote_ReturnsConsistencyTokenHeader()
    {
        var (noteId, _) = await CreateNoteAsync();
        var folderId = await CreateFolderAsync("People");
        await PutAsync($"/notes/{noteId}/folder", $"{{\"folderId\":\"{folderId}\"}}");

        var unfileResp = await _client.DeleteAsync($"/notes/{noteId}/folder");
        unfileResp.EnsureSuccessStatusCode();

        var token = Assert.Single(unfileResp.Headers.GetValues("X-Consistency-Token"));
        var (stream, _) = ParseToken(token);
        Assert.Equal($"note#{noteId}", stream);
    }

    private static (string Stream, long Version) ParseToken(string token)
    {
        var at = token.LastIndexOf('@');
        return (token[..at], long.Parse(token[(at + 1)..]));
    }

    private async Task<(string NoteId, string Token)> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        var noteId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        var token = resp.Headers.GetValues("X-Consistency-Token").Single();
        return (noteId, token);
    }

    private async Task<string> CreateWorkspaceAsync(string name)
    {
        var resp = await _client.PostAsync("/workspaces",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("workspaceId").GetString()!;
    }

    private async Task<string> CreateFolderAsync(string name)
    {
        var resp = await _client.PostAsync("/folders",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("folderId").GetString()!;
    }

    private Task<HttpResponseMessage> PutAsync(string url, string json) =>
        _client.PutAsync(url, new StringContent(json, Encoding.UTF8, "application/json"));
}
