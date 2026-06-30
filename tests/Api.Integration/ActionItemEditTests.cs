using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

public sealed class ActionItemEditTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task EditAction_OpenItem_Returns200AndUpdatesText()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();

        var resp = await _client.PutAsJsonAsync($"/notes/{noteId}/actions/{actionId}", new { description = "Chase Acme invoice" });

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var view = await _client.GetAsync($"/notes/{noteId}/actions");
        view.EnsureSuccessStatusCode();
        var body = await view.Content.ReadFromJsonAsync<JsonElement>();
        var action = body.GetProperty("actions").EnumerateArray().First();
        Assert.Equal("Chase Acme invoice", action.GetProperty("description").GetString());
    }

    [Fact]
    public async Task EditAction_EmptyDescription_Returns400()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();

        var resp = await _client.PutAsJsonAsync($"/notes/{noteId}/actions/{actionId}", new { description = "   " });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task EditAction_NonexistentAction_Returns404()
    {
        var noteResp = await _client.PostAsync("/notes", null);
        var noteId = (await noteResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;

        var resp = await _client.PutAsJsonAsync($"/notes/{noteId}/actions/{Guid.NewGuid()}", new { description = "Anything" });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task EditAction_DeletedItem_Returns404()
    {
        // BUG-41: object-level auth (IActionItemAuthorizer.OwnsActionAsync) treats a deleted action as
        // gone, so editing it is 404 (not the old 409). A deleted action no longer exists — 404 is the
        // honest answer and matches the MCP action-item tools, which reject a deleted action the same way.
        var (noteId, actionId) = await CreateNoteWithActionAsync();
        await _client.DeleteAsync($"/notes/{noteId}/actions/{actionId}");

        var resp = await _client.PutAsJsonAsync($"/notes/{noteId}/actions/{actionId}", new { description = "Chase Acme invoice" });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task EditAction_ThenComplete_PreservesEditedText()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();
        await _client.PutAsJsonAsync($"/notes/{noteId}/actions/{actionId}", new { description = "Chase Acme invoice" });
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);

        var view = await _client.GetAsync($"/notes/{noteId}/actions");
        view.EnsureSuccessStatusCode();
        var body = await view.Content.ReadFromJsonAsync<JsonElement>();
        var action = body.GetProperty("actions").EnumerateArray().First();

        Assert.Equal("Chase Acme invoice", action.GetProperty("description").GetString());
        Assert.True(action.GetProperty("completed").GetBoolean());
    }

    [Fact]
    public async Task EditAction_AfterComplete_PreservesEditedTextAndCompletion()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        await _client.PutAsJsonAsync($"/notes/{noteId}/actions/{actionId}", new { description = "Chase Acme invoice" });

        var view = await _client.GetAsync($"/notes/{noteId}/actions");
        view.EnsureSuccessStatusCode();
        var body = await view.Content.ReadFromJsonAsync<JsonElement>();
        var action = body.GetProperty("actions").EnumerateArray().First();

        Assert.Equal("Chase Acme invoice", action.GetProperty("description").GetString());
        Assert.True(action.GetProperty("completed").GetBoolean());
    }

    private async Task<(string noteId, Guid actionId)> CreateNoteWithActionAsync()
    {
        var noteResp = await _client.PostAsync("/notes", null);
        var noteBody = await noteResp.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = noteBody.GetProperty("noteId").GetString()!;

        var actionResp = await _client.PostAsJsonAsync($"/notes/{noteId}/actions", new { description = "Chase invoice" });
        var actionBody = await actionResp.Content.ReadFromJsonAsync<JsonElement>();
        var actionId = Guid.Parse(actionBody.GetProperty("actionId").GetString()!);

        return (noteId, actionId);
    }
}
