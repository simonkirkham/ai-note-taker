using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class DeleteActionItemSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task DeletingActionItem_RemovesItFromNoteAndTodoList()
    {
        var desc = $"DEL-accept-{Guid.NewGuid():N}"[..30];
        var (noteId, _) = await CreateNoteAsync("Delete Action Note");
        var actionId = await AddActionAsync(noteId, desc);

        var deleteResp = await fixture.Client.DeleteAsync(
            $"notes/{noteId}/actions/{actionId}");
        deleteResp.EnsureSuccessStatusCode();

        var actionsResp = await fixture.Client.GetAsync($"notes/{noteId}/actions");
        actionsResp.EnsureSuccessStatusCode();
        var actions = (await actionsResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("actions").EnumerateArray().ToList();
        Assert.DoesNotContain(actions, a =>
            a.GetProperty("actionId").GetString() == actionId.ToString());

        var todos = await GetTodoItemsAsync();
        Assert.DoesNotContain(todos, i =>
            i.GetProperty("description").GetString() == desc);
    }

    [Fact]
    public async Task DeletingNonExistentActionItem_Returns404()
    {
        var noteId = Guid.NewGuid();
        var actionId = Guid.NewGuid();

        var resp = await fixture.Client.DeleteAsync($"notes/{noteId}/actions/{actionId}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<List<JsonElement>> GetTodoItemsAsync()
    {
        var resp = await fixture.Client.GetAsync("todos");
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();
    }

    private async Task<(string NoteId, string Title)> CreateNoteAsync(string title)
    {
        var noteResp = await fixture.Client.PostAsync("notes", null);
        var noteBody = await noteResp.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = noteBody.GetProperty("noteId").GetString()!;
        await fixture.Client.PatchAsJsonAsync($"notes/{noteId}/title", new { title });
        return (noteId, title);
    }

    private async Task<Guid> AddActionAsync(string noteId, string description)
    {
        var resp = await fixture.Client.PostAsJsonAsync(
            $"notes/{noteId}/actions", new { description });
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return Guid.Parse(body.GetProperty("actionId").GetString()!);
    }
}
