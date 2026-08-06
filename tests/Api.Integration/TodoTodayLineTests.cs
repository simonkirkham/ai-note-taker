using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

// The Today line (50-A) is a per-workspace marker in the existing priority order: it sits
// immediately ABOVE its anchor item; a null anchor puts it below everything (all Today).
// GET /todos always reports an anchor that is a currently-OPEN item — the "anchor completed /
// gone" rule is resolved on read (first still-open item at or after the stored anchor's
// position), so no relocation write is needed and the client never has to reason about it.
//
// Each test gets its OWN factory rather than a shared IClassFixture: the line is a single
// per-workspace value and resolving it walks the whole list, so a sibling test's leftover
// items would decide where the line lands.
public sealed class TodoTodayLineTests
{
    [Fact]
    public async Task TodayLine_IsUnsetUntilTheUserDrawsIt()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        await CreateTodoAsync(client, "A");

        Assert.Null(await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task SetTodayLine_ReturnsTheOrderStreamWriteToken()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");

        var resp = await client.PostAsJsonAsync("/todos/today-line", new { anchorItemId = a });

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith("todo-order#", body.GetProperty("consistencyToken").GetString());
    }

    [Fact]
    public async Task SetTodayLine_PersistsTheAnchor()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");

        await SetTodayLineAsync(client, b);

        Assert.Equal(b, await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task SetTodayLine_NullAnchorPutsTheLineBelowEverything()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        await SetTodayLineAsync(client, a);

        await SetTodayLineAsync(client, null);

        Assert.Null(await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task SetTodayLine_BlankAnchor_Returns400()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();

        var resp = await client.PostAsJsonAsync("/todos/today-line", new { anchorItemId = "   " });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task TodayLine_SurvivesAReorderOfTheItemsAroundIt()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");
        var c = await CreateTodoAsync(client, "C");
        await SetTodayLineAsync(client, c);

        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { b, a, c } });

        Assert.Equal(c, await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task CompletingTheAnchor_MovesTheLineToTheNextOpenItem()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");
        var c = await CreateTodoAsync(client, "C");
        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { a, b, c } });
        await SetTodayLineAsync(client, b);

        (await client.PostAsync($"/todos/{b}/complete", null)).EnsureSuccessStatusCode();

        // b left the open list; the line holds its visual place — above what was after b.
        Assert.Equal(c, await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task CompletingTheLastAnchoredItem_PutsTheLineBelowEverything()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");
        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { a, b } });
        await SetTodayLineAsync(client, b);

        (await client.PostAsync($"/todos/{b}/complete", null)).EnsureSuccessStatusCode();

        Assert.Null(await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task CompletingTheItemAboveTheLine_LeavesTheAnchorAlone()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");
        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { a, b } });
        await SetTodayLineAsync(client, b);

        (await client.PostAsync($"/todos/{a}/complete", null)).EnsureSuccessStatusCode();

        Assert.Equal(b, await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task DeletingTheAnchor_PutsTheLineBelowEverything()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");
        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { a, b } });
        await SetTodayLineAsync(client, b);

        (await client.DeleteAsync($"/todos/{b}")).EnsureSuccessStatusCode();

        // The row is gone entirely, so its place in the order is unknowable — the line falls to
        // the bottom rather than guessing. The client re-anchors on the delete it initiated.
        Assert.Null(await GetTodayLineAsync(client));
    }

    private static async Task<string> CreateTodoAsync(HttpClient client, string description)
    {
        var resp = await client.PostAsJsonAsync("/todos", new { description });
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("todoId").GetString()!;
    }

    private static async Task SetTodayLineAsync(HttpClient client, string? anchorItemId)
    {
        var resp = await client.PostAsJsonAsync("/todos/today-line", new { anchorItemId });
        resp.EnsureSuccessStatusCode();
    }

    private static async Task<string?> GetTodayLineAsync(HttpClient client)
    {
        var resp = await client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var anchor = body.GetProperty("todayLineAnchorItemId");
        return anchor.ValueKind == JsonValueKind.Null ? null : anchor.GetString();
    }
}
