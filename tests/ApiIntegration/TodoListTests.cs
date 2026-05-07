using System.Net.Http.Json;
using System.Text.Json;

namespace ApiIntegration;

public sealed class TodoListTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetTodos_ReturnsOkWithItemsArray()
    {
        var resp = await _client.GetAsync("/todos");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out _));
    }

    [Fact]
    public async Task GetTodos_OpenActionItem_AppearsWithNoteTitle()
    {
        var (_, noteTitle, _, actionDescription) = await SetupNoteWithActionAsync("Q1 Planning", "Book venue");

        var items = await GetTodoItemsAsync();

        Assert.Contains(items, i =>
            i.GetProperty("description").GetString() == actionDescription &&
            i.GetProperty("noteTitle").GetString() == noteTitle);
    }

    [Fact]
    public async Task GetTodos_CompletedItem_NotInList()
    {
        var (noteId, _, actionId, _) = await SetupNoteWithActionAsync("Planning", "Book venue");
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);

        var items = await GetTodoItemsAsync();

        Assert.DoesNotContain(items, i =>
            i.GetProperty("actionId").GetString() == actionId.ToString());
    }

    [Fact]
    public async Task GetTodos_ReopenedItem_AppearsInList()
    {
        var (noteId, _, actionId, description) = await SetupNoteWithActionAsync("Planning", "Reopen task");
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/reopen", null);

        var items = await GetTodoItemsAsync();

        Assert.Contains(items, i =>
            i.GetProperty("actionId").GetString() == actionId.ToString() &&
            i.GetProperty("description").GetString() == description);
    }

    [Fact]
    public async Task GetTodos_MultipleNotes_ShowsAllOpenItems()
    {
        var (_, _, _, descA) = await SetupNoteWithActionAsync("Note Alpha", $"Task-A-{Guid.NewGuid()}");
        var (_, _, _, descB) = await SetupNoteWithActionAsync("Note Beta",  $"Task-B-{Guid.NewGuid()}");

        var items = await GetTodoItemsAsync();

        Assert.Contains(items, i => i.GetProperty("description").GetString() == descA);
        Assert.Contains(items, i => i.GetProperty("description").GetString() == descB);
    }

    [Fact]
    public async Task GetTodos_AfterNoteRename_ShowsNewTitle()
    {
        var uniqueDesc = $"Rename-test-{Guid.NewGuid()}";
        var (noteId, _, _, _) = await SetupNoteWithActionAsync("Old Title", uniqueDesc);
        await _client.PatchAsJsonAsync($"/notes/{noteId}/title", new { title = "New Title" });

        var items = await GetTodoItemsAsync();

        Assert.Contains(items, i =>
            i.GetProperty("description").GetString() == uniqueDesc &&
            i.GetProperty("noteTitle").GetString() == "New Title");
    }

    private async Task<List<JsonElement>> GetTodoItemsAsync()
    {
        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();
    }

    private async Task<(string NoteId, string NoteTitle, Guid ActionId, string ActionDescription)>
        SetupNoteWithActionAsync(string title, string actionDescription)
    {
        var noteResp = await _client.PostAsync("/notes", null);
        var noteBody = await noteResp.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = noteBody.GetProperty("noteId").GetString()!;

        await _client.PatchAsJsonAsync($"/notes/{noteId}/title", new { title });

        var actionResp = await _client.PostAsJsonAsync($"/notes/{noteId}/actions",
            new { description = actionDescription });
        var actionBody = await actionResp.Content.ReadFromJsonAsync<JsonElement>();
        var actionId = Guid.Parse(actionBody.GetProperty("actionId").GetString()!);

        return (noteId, title, actionId, actionDescription);
    }
}
