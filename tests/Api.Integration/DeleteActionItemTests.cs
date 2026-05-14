using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

public sealed class DeleteActionItemTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task DeleteAction_ExistingItem_Returns204()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();

        var resp = await _client.DeleteAsync($"/notes/{noteId}/actions/{actionId}");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteAction_NonExistentItem_Returns404()
    {
        var noteId = Guid.NewGuid();
        var actionId = Guid.NewGuid();

        var resp = await _client.DeleteAsync($"/notes/{noteId}/actions/{actionId}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteAction_RemovedFromNoteActions()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();
        await _client.DeleteAsync($"/notes/{noteId}/actions/{actionId}");

        var resp = await _client.GetAsync($"/notes/{noteId}/actions");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var actions = body.GetProperty("actions").EnumerateArray().ToList();

        Assert.DoesNotContain(actions, a => a.GetProperty("actionId").GetString() == actionId.ToString());
    }

    [Fact]
    public async Task DeleteAction_RemovedFromTodoList()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();
        await _client.DeleteAsync($"/notes/{noteId}/actions/{actionId}");

        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        Assert.DoesNotContain(items, i => i.GetProperty("actionId").GetString() == actionId.ToString());
    }

    private async Task<(string noteId, Guid actionId)> CreateNoteWithActionAsync()
    {
        var noteResp = await _client.PostAsync("/notes", null);
        var noteBody = await noteResp.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = noteBody.GetProperty("noteId").GetString()!;

        var actionResp = await _client.PostAsJsonAsync($"/notes/{noteId}/actions", new { description = "Old task" });
        var actionBody = await actionResp.Content.ReadFromJsonAsync<JsonElement>();
        var actionId = Guid.Parse(actionBody.GetProperty("actionId").GetString()!);

        return (noteId, actionId);
    }
}
