using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class ActionItemsIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PostAction_ExistingNote_Returns201WithActionId()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/actions", new { description = "Book meeting room" });

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(Guid.TryParse(body.GetProperty("actionId").GetString(), out _));
    }

    [Fact]
    public async Task PostAction_NonExistentNote_Returns404()
    {
        var resp = await _client.PostAsJsonAsync($"/notes/{Guid.NewGuid()}/actions", new { description = "Anything" });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task PostAction_DuplicateActionId_Returns409()
    {
        var noteId = await CreateNoteAsync();
        var actionId = Guid.NewGuid();

        await _client.PostAsJsonAsync($"/notes/{noteId}/actions", new { description = "First", actionId });
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/actions", new { description = "Second", actionId });

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task GetActions_AfterAddingItem_ReturnsItem()
    {
        var noteId = await CreateNoteAsync();
        await _client.PostAsJsonAsync($"/notes/{noteId}/actions", new { description = "Book meeting room" });

        var resp = await _client.GetAsync($"/notes/{noteId}/actions");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var actions = body.GetProperty("actions").EnumerateArray().ToList();
        Assert.Single(actions);
        Assert.Equal("Book meeting room", actions[0].GetProperty("description").GetString());
        Assert.False(actions[0].GetProperty("completed").GetBoolean());
    }

    [Fact]
    public async Task GetActions_NoteWithNoActions_ReturnsEmptyList()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.GetAsync($"/notes/{noteId}/actions");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(body.GetProperty("actions").EnumerateArray());
    }

    [Fact]
    public async Task GetActions_NonExistentNote_Returns404()
    {
        var resp = await _client.GetAsync($"/notes/{Guid.NewGuid()}/actions");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }
}
