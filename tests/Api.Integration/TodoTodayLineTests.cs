using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

// The Today line (50-A) is a per-workspace marker in the existing priority order: it sits
// immediately ABOVE its anchor item; a null anchor puts it below everything (all Today).
// GET /todos always reports an anchor that is a currently-OPEN item. When the anchor stops being
// open the PROJECTOR relocates it durably (next still-open item after it); the read-side resolution
// is only the transient window before that lands. Relocating durably is what stops a completed
// anchor from aging out of the read window days later and silently dropping the line to the bottom.
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
    public async Task DeletingTheAnchor_MovesTheLineToTheNextOpenItem()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");
        var c = await CreateTodoAsync(client, "C");
        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { a, b, c } });
        await SetTodayLineAsync(client, b);

        (await client.DeleteAsync($"/todos/{b}")).EnsureSuccessStatusCode();

        // The projector relocates before the row goes, so the line holds its visual place even
        // though the delete came from a path that never touched the line.
        Assert.Equal(c, await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task DeletingTheLastAnchoredItem_PutsTheLineBelowEverything()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");
        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { a, b } });
        await SetTodayLineAsync(client, b);

        (await client.DeleteAsync($"/todos/{b}")).EnsureSuccessStatusCode();

        Assert.Null(await GetTodayLineAsync(client));
    }

    // The regression that matters: resolving on read alone would look right for ~2 days and then
    // silently drop the line to the bottom once the completed anchor ages out of the read window.
    // Assert the STORED anchor moved, not just the resolved one.
    [Fact]
    public async Task CompletingTheAnchor_RelocatesTheStoredAnchorNotJustTheRead()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var a = await CreateTodoAsync(client, "A");
        var b = await CreateTodoAsync(client, "B");
        var c = await CreateTodoAsync(client, "C");
        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { a, b, c } });
        await SetTodayLineAsync(client, b);

        (await client.PostAsync($"/todos/{b}/complete", null)).EnsureSuccessStatusCode();

        using var scope = factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<ITodoListStore>();
        var stored = await store.GetTodayLineAnchorAsync(FakeCurrentUser.TestUserId, "__default__");
        Assert.Equal(c, stored);
    }

    // Deleting the note cascades its action items out of the list; the line must not go with them.
    [Fact]
    public async Task TodayLineAnchoredToAnActionItem_SurvivesDeletingItsNote()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var standalone = await CreateTodoAsync(client, "Standalone");
        var (noteId, actionId) = await CreateNoteWithActionAsync(client);
        await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { actionId, standalone } });
        await SetTodayLineAsync(client, actionId);

        (await client.DeleteAsync($"/notes/{noteId}")).EnsureSuccessStatusCode();

        Assert.Equal(standalone, await GetTodayLineAsync(client));
    }

    private static async Task<(string NoteId, string ActionId)> CreateNoteWithActionAsync(HttpClient client)
    {
        var noteResp = await client.PostAsync("/notes", null);
        noteResp.EnsureSuccessStatusCode();
        var noteId = (await noteResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        var actionResp = await client.PostAsJsonAsync($"/notes/{noteId}/actions", new { description = "Action from note" });
        actionResp.EnsureSuccessStatusCode();
        var actionId = (await actionResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("actionId").GetString()!;
        return (noteId, actionId);
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
