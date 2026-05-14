using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class ActionItemCompleteSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task CompleteAction_OpenItem_Returns200()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();

        var resp = await fixture.Client.PostAsync($"notes/{noteId}/actions/{actionId}/complete", null);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task ReopenAction_CompletedItem_Returns200()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();
        await fixture.Client.PostAsync($"notes/{noteId}/actions/{actionId}/complete", null);

        var resp = await fixture.Client.PostAsync($"notes/{noteId}/actions/{actionId}/reopen", null);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task GetActions_AfterCompleteAndReopen_ReflectsState()
    {
        var (noteId, actionId) = await CreateNoteWithActionAsync();

        await fixture.Client.PostAsync($"notes/{noteId}/actions/{actionId}/complete", null);
        var afterComplete = await GetActionAsync(noteId);
        Assert.True(afterComplete.GetProperty("completed").GetBoolean());

        await fixture.Client.PostAsync($"notes/{noteId}/actions/{actionId}/reopen", null);
        var afterReopen = await GetActionAsync(noteId);
        Assert.False(afterReopen.GetProperty("completed").GetBoolean());
    }

    private async Task<JsonElement> GetActionAsync(string noteId)
    {
        var resp = await fixture.Client.GetAsync($"notes/{noteId}/actions");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("actions").EnumerateArray().First();
    }

    private async Task<(string noteId, Guid actionId)> CreateNoteWithActionAsync()
    {
        var noteResp = await fixture.Client.PostAsync("notes", null);
        var noteBody = await noteResp.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = noteBody.GetProperty("noteId").GetString()!;

        var actionResp = await fixture.Client.PostAsJsonAsync($"notes/{noteId}/actions", new { description = "Chase invoice" });
        var actionBody = await actionResp.Content.ReadFromJsonAsync<JsonElement>();
        var actionId = Guid.Parse(actionBody.GetProperty("actionId").GetString()!);

        return (noteId, actionId);
    }
}
