using System.Net.Http.Json;
using System.Text.Json;

namespace Acceptance;

[Collection("Deployed API")]
public sealed class TodoListSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task GetTodos_ReturnsOkWithItemsArray()
    {
        var resp = await fixture.Client.GetAsync("todos");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out _));
    }

    [Fact]
    public async Task GetTodos_OpenItem_AppearsWithNoteTitle()
    {
        var uniqueDesc = $"Send-recap-{Guid.NewGuid():N}"[..30];
        var (noteId, _) = await CreateNoteAsync("Acceptance Planning");
        await AddActionAsync(noteId, uniqueDesc);

        var items = await GetTodoItemsAsync();

        Assert.Contains(items, i =>
            i.GetProperty("description").GetString() == uniqueDesc &&
            i.GetProperty("noteTitle").GetString() == "Acceptance Planning");
    }

    [Fact]
    public async Task GetTodos_CompletedItem_NotInList()
    {
        var uniqueDesc = $"Completed-task-{Guid.NewGuid():N}"[..30];
        var (noteId, _) = await CreateNoteAsync("Complete Test");
        var actionId = await AddActionAsync(noteId, uniqueDesc);
        await fixture.Client.PostAsync($"notes/{noteId}/actions/{actionId}/complete", null);

        var items = await GetTodoItemsAsync();

        Assert.DoesNotContain(items, i =>
            i.GetProperty("description").GetString() == uniqueDesc);
    }

    [Fact]
    public async Task GetTodos_AfterNoteRename_ShowsNewTitle()
    {
        var uniqueDesc = $"Rename-task-{Guid.NewGuid():N}"[..30];
        var (noteId, _) = await CreateNoteAsync("Before Rename");
        await AddActionAsync(noteId, uniqueDesc);
        await fixture.Client.PatchAsJsonAsync($"notes/{noteId}/title", new { title = "After Rename" });

        var items = await GetTodoItemsAsync();

        Assert.Contains(items, i =>
            i.GetProperty("description").GetString() == uniqueDesc &&
            i.GetProperty("noteTitle").GetString() == "After Rename");
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
        var resp = await fixture.Client.PostAsJsonAsync($"notes/{noteId}/actions", new { description });
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return Guid.Parse(body.GetProperty("actionId").GetString()!);
    }
}
