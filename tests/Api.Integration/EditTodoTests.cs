using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

public sealed class EditTodoTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task EditTodo_UpdatesDescription()
    {
        var todoId = await CreateTodoAsync("Buy milk");

        var resp = await _client.PutAsJsonAsync($"/todos/{todoId}", new { description = "Buy oat milk" });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var item = (await GetTodoItemsAsync()).Single(i => i.GetProperty("itemId").GetString() == todoId.ToString());
        Assert.Equal("Buy oat milk", item.GetProperty("description").GetString());
    }

    [Fact]
    public async Task EditTodo_EmptyDescription_Returns400()
    {
        var todoId = await CreateTodoAsync("Buy milk");

        var resp = await _client.PutAsJsonAsync($"/todos/{todoId}", new { description = "   " });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task EditTodo_UnknownId_Returns404()
    {
        var resp = await _client.PutAsJsonAsync($"/todos/{Guid.NewGuid()}", new { description = "Anything" });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task EditTodo_Deleted_Returns404()
    {
        // A deleted todo is removed from the TodoList projection, so the ownership gate
        // (OwnsTodoAsync reads the projection) returns 404 before the aggregate's edit guard —
        // consistent with CompleteTodo/DeleteTodo on a deleted todo. The handler's 409 catch is a
        // defensive edge for projection lag only.
        var todoId = await CreateTodoAsync("Buy milk");
        await _client.DeleteAsync($"/todos/{todoId}");

        var resp = await _client.PutAsJsonAsync($"/todos/{todoId}", new { description = "Buy oat milk" });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task EditTodo_AfterComplete_PreservesEditedTextAndCompletion()
    {
        var todoId = await CreateTodoAsync("Buy milk");
        await _client.PostAsync($"/todos/{todoId}/complete", null);
        await _client.PutAsJsonAsync($"/todos/{todoId}", new { description = "Buy oat milk" });

        var item = (await GetTodoItemsAsync()).Single(i => i.GetProperty("itemId").GetString() == todoId.ToString());
        Assert.Equal("Buy oat milk", item.GetProperty("description").GetString());
        Assert.NotEqual(JsonValueKind.Null, item.GetProperty("completedAt").ValueKind);
    }

    private async Task<Guid> CreateTodoAsync(string description)
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
