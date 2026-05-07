using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ApiIntegration;

public sealed class TodoListTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetTodos_NoItems_ReturnsEmptyList()
    {
        var resp = await _client.GetAsync("/todos");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(body.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task GetTodos_OpenActionItem_AppearsWithNoteTitle()
    {
        var (_, noteTitle, _, actionDescription) = await SetupNoteWithActionAsync("Q1 Planning", "Book venue");

        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var items = (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();

        Assert.Single(items);
        Assert.Equal(actionDescription, items[0].GetProperty("description").GetString());
        Assert.Equal(noteTitle, items[0].GetProperty("noteTitle").GetString());
    }

    [Fact]
    public async Task GetTodos_CompletedItem_NotInList()
    {
        var (noteId, _, actionId, _) = await SetupNoteWithActionAsync("Planning", "Book venue");
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);

        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var items = (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();

        Assert.Empty(items);
    }

    [Fact]
    public async Task GetTodos_ReopenedItem_AppearsInList()
    {
        var (noteId, _, actionId, description) = await SetupNoteWithActionAsync("Planning", "Book venue");
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/reopen", null);

        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var items = (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();

        Assert.Single(items);
        Assert.Equal(description, items[0].GetProperty("description").GetString());
    }

    [Fact]
    public async Task GetTodos_MultipleNotes_ShowsAllOpenItems()
    {
        await SetupNoteWithActionAsync("Note A", "Task from A");
        await SetupNoteWithActionAsync("Note B", "Task from B");

        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var items = (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();

        Assert.Contains(items, i => i.GetProperty("description").GetString() == "Task from A");
        Assert.Contains(items, i => i.GetProperty("description").GetString() == "Task from B");
    }

    [Fact]
    public async Task GetTodos_AfterNoteRename_ShowsNewTitle()
    {
        var (noteId, _, _, _) = await SetupNoteWithActionAsync("Old Title", "Do something");
        await _client.PatchAsJsonAsync($"/notes/{noteId}/title", new { title = "New Title" });

        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var items = (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();

        Assert.Single(items);
        Assert.Equal("New Title", items[0].GetProperty("noteTitle").GetString());
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
