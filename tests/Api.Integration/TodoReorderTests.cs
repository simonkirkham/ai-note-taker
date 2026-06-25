using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

public sealed class TodoReorderTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Reorder_PersistsTheNewOrder()
    {
        var a = await CreateTodoAsync("reorder-A");
        var b = await CreateTodoAsync("reorder-B");
        var c = await CreateTodoAsync("reorder-C");

        var resp = await _client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { c, a, b } });

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var token = body.GetProperty("consistencyToken").GetString()!;
        Assert.StartsWith("todo-order#", token);

        var order = await GetOrderOfAsync(a, b, c);
        Assert.Equal(new[] { c, a, b }, order);
    }

    [Fact]
    public async Task Reorder_NewTodoAppendsAfterOrderedItems()
    {
        var a = await CreateTodoAsync("append-A");
        var b = await CreateTodoAsync("append-B");
        await _client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { b, a } });

        var c = await CreateTodoAsync("append-C");

        var order = await GetOrderOfAsync(a, b, c);
        Assert.Equal(new[] { b, a, c }, order);
    }

    [Fact]
    public async Task Reorder_EmptyList_Returns400()
    {
        var resp = await _client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = Array.Empty<string>() });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    private async Task<string> CreateTodoAsync(string description)
    {
        var resp = await _client.PostAsJsonAsync("/todos", new { description });
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("todoId").GetString()!;
    }

    // The relative order of the given ids within GET /todos (other tests in the class may add items).
    private async Task<List<string>> GetOrderOfAsync(params string[] ids)
    {
        var resp = await _client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var set = ids.ToHashSet();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("itemId").GetString()!)
            .Where(set.Contains)
            .ToList();
    }
}
