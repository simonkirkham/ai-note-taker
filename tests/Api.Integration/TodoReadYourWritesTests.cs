using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

// RYW-1 end-to-end through the HTTP layer: POST /todos returns a consistency token; GET /todos
// carrying it in If-Consistent-With waits on the gate until the projector has applied the add,
// then returns the list including the new todo. In-process the SyncProjectingEventStore drives
// the SAME StreamProjector path that runs async in prod, sharing one position store with the
// gate — so this exercises token -> async projector -> gate-wait -> read-your-writes.
public sealed class TodoReadYourWritesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PostTodos_ReturnsConsistencyToken_ShapedStreamAtVersion()
    {
        var resp = await _client.PostAsJsonAsync("/todos", new { description = "token please" });

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var todoId = body.GetProperty("todoId").GetString()!;
        var token = body.GetProperty("consistencyToken").GetString()!;

        // First write to a fresh todo stream is version 1.
        Assert.Equal($"todo#{todoId}@1", token);
    }

    [Fact]
    public async Task GetTodos_WithConsistencyToken_SeesTheNewTodo()
    {
        var desc = $"ryw-{Guid.NewGuid()}";
        var addResp = await _client.PostAsJsonAsync("/todos", new { description = desc });
        addResp.EnsureSuccessStatusCode();
        var body = await addResp.Content.ReadFromJsonAsync<JsonElement>();
        var token = body.GetProperty("consistencyToken").GetString()!;

        var req = new HttpRequestMessage(HttpMethod.Get, "/todos");
        req.Headers.Add("If-Consistent-With", token);
        var getResp = await _client.SendAsync(req);

        getResp.EnsureSuccessStatusCode();
        // The gate found the projection already caught up (sync decorator), so the read is not stale.
        Assert.False(getResp.Headers.Contains("X-Consistency"));
        var items = (await getResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();
        Assert.Contains(items, i => i.GetProperty("description").GetString() == desc);
    }
}
