using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class CrossUserIsolationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _owner = factory.CreateClient();
    private readonly HttpClient _other = factory.CreateClientAsOtherUser();

    // ── Notes ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task RenameNote_OtherUser_Returns404()
    {
        var noteId = await CreateNoteAsync(_owner);
        var resp = await _other.PatchAsync($"/notes/{noteId}/title",
            Json("{\"title\":\"Stolen\"}"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task EditContent_OtherUser_Returns404()
    {
        var noteId = await CreateNoteAsync(_owner);
        var resp = await _other.PutAsync($"/notes/{noteId}/content",
            Json("{\"content\":\"hacked\"}"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteNote_OtherUser_Returns404()
    {
        var noteId = await CreateNoteAsync(_owner);
        var resp = await _other.DeleteAsync($"/notes/{noteId}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task SetNoteDate_OtherUser_Returns404()
    {
        var noteId = await CreateNoteAsync(_owner);
        var resp = await _other.PatchAsync($"/notes/{noteId}/date",
            Json("{\"date\":\"2024-01-01\"}"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task PostTag_OtherUser_Returns404()
    {
        var noteId = await CreateNoteAsync(_owner);
        var resp = await _other.PostAsync($"/notes/{noteId}/tags",
            Json("{\"tag\":\"stolen\"}"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // ── Action items ───────────────────────────────────────────────────────

    [Fact]
    public async Task AddActionItem_OtherUser_Returns404()
    {
        var noteId = await CreateNoteAsync(_owner);
        var resp = await _other.PostAsync($"/notes/{noteId}/actions",
            Json("{\"description\":\"do something\"}"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task CompleteActionItem_OtherUser_Returns404()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync(_owner);
        var resp = await _other.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task ReopenActionItem_OtherUser_Returns404()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync(_owner);
        await _owner.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        var resp = await _other.PostAsync($"/notes/{noteId}/actions/{actionId}/reopen", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteActionItem_OtherUser_Returns404()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync(_owner);
        var resp = await _other.DeleteAsync($"/notes/{noteId}/actions/{actionId}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // ── Folders ────────────────────────────────────────────────────────────

    [Fact]
    public async Task RenameFolder_OtherUser_Returns404()
    {
        var folderId = await CreateFolderAsync(_owner);
        var resp = await _other.PatchAsync($"/folders/{folderId}/name",
            Json("{\"name\":\"Stolen\"}"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteFolder_OtherUser_Returns404()
    {
        var folderId = await CreateFolderAsync(_owner);
        var resp = await _other.DeleteAsync($"/folders/{folderId}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task MoveFolder_OtherUserTriesToMoveOwnersFolder_Returns404()
    {
        var folderId = await CreateFolderAsync(_owner);
        var resp = await _other.PutAsync($"/folders/{folderId}/parent",
            Json("{\"parentFolderId\":null}"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private static async Task<string> CreateNoteAsync(HttpClient client)
    {
        var resp = await client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private static async Task<(string NoteId, string ActionId)> CreateNoteWithActionAsync(HttpClient client)
    {
        var noteId = await CreateNoteAsync(client);
        var resp = await client.PostAsync($"/notes/{noteId}/actions",
            Json("{\"description\":\"do something\"}"));
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return (noteId, body.GetProperty("actionId").GetString()!);
    }

    private static async Task<string> CreateFolderAsync(HttpClient client)
    {
        var resp = await client.PostAsync("/folders",
            Json("{\"name\":\"My Folder\"}"));
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("folderId").GetString()!;
    }

    private static StringContent Json(string json) =>
        new(json, Encoding.UTF8, "application/json");
}
