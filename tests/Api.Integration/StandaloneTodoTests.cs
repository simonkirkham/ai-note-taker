using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

public sealed class StandaloneTodoTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PostTodos_CreatesStandaloneTodo()
    {
        var resp = await _client.PostAsJsonAsync("/todos", new { description = "Buy milk" });

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("todoId", out var id));
        Assert.NotEqual(Guid.Empty, Guid.Parse(id.GetString()!));
    }

    [Fact]
    public async Task PostTodos_AppearsInGetTodos()
    {
        var desc = $"standalone-{Guid.NewGuid()}";
        var addResp = await _client.PostAsJsonAsync("/todos", new { description = desc });
        var body = await addResp.Content.ReadFromJsonAsync<JsonElement>();
        var todoId = body.GetProperty("todoId").GetString()!;

        var items = await GetTodoItemsAsync();

        var item = items.Single(i => i.GetProperty("itemId").GetString() == todoId);
        Assert.Equal("todo", item.GetProperty("type").GetString());
        Assert.Equal(desc, item.GetProperty("description").GetString());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("noteId").ValueKind);
        Assert.Equal(JsonValueKind.Null, item.GetProperty("completedAt").ValueKind);
    }

    [Fact]
    public async Task CompleteTodo_SetsCompletedAt()
    {
        var todoId = await CreateStandaloneTodoAsync("Complete me");

        var resp = await _client.PostAsync($"/todos/{todoId}/complete", null);

        resp.EnsureSuccessStatusCode();
        var items = await GetTodoItemsAsync();
        var item = items.Single(i => i.GetProperty("itemId").GetString() == todoId.ToString());
        Assert.NotEqual(JsonValueKind.Null, item.GetProperty("completedAt").ValueKind);
    }

    [Fact]
    public async Task ReopenTodo_ClearsCompletedAt()
    {
        var todoId = await CreateStandaloneTodoAsync("Reopen me");
        await _client.PostAsync($"/todos/{todoId}/complete", null);

        var resp = await _client.PostAsync($"/todos/{todoId}/reopen", null);

        resp.EnsureSuccessStatusCode();
        var items = await GetTodoItemsAsync();
        var item = items.Single(i => i.GetProperty("itemId").GetString() == todoId.ToString());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("completedAt").ValueKind);
    }

    [Fact]
    public async Task DeleteTodo_RemovesFromList()
    {
        var todoId = await CreateStandaloneTodoAsync("Delete me");

        var resp = await _client.DeleteAsync($"/todos/{todoId}");

        resp.EnsureSuccessStatusCode();
        var items = await GetTodoItemsAsync();
        Assert.DoesNotContain(items, i => i.GetProperty("itemId").GetString() == todoId.ToString());
    }

    [Fact]
    public async Task PostTodos_EmptyDescription_Returns400()
    {
        var resp = await _client.PostAsJsonAsync("/todos", new { description = "   " });

        Assert.Equal(System.Net.HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task CompleteTodo_UnknownId_Returns404()
    {
        var resp = await _client.PostAsync($"/todos/{Guid.NewGuid()}/complete", null);

        Assert.Equal(System.Net.HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task ReopenTodo_UnknownId_Returns404()
    {
        var resp = await _client.PostAsync($"/todos/{Guid.NewGuid()}/reopen", null);

        Assert.Equal(System.Net.HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteTodo_UnknownId_Returns404()
    {
        var resp = await _client.DeleteAsync($"/todos/{Guid.NewGuid()}");

        Assert.Equal(System.Net.HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<Guid> CreateStandaloneTodoAsync(string description)
    {
        var resp = await _client.PostAsJsonAsync("/todos", new { description });
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return Guid.Parse(body.GetProperty("todoId").GetString()!);
    }

    private async Task<List<JsonElement>> GetTodoItemsAsync()
    {
        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();
    }
}
