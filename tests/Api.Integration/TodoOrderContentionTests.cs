using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EventStore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.AspNetCore.TestHost;

namespace Api.Integration;

// 50-B: "Move to Later" issues a ReorderTodos and a SetTodayLine in the SAME tick, and both
// append to the one per-workspace ordering stream (todo-order#{workspaceId}). That stream is
// stable-id, so every ordering write in the workspace already contended on a single partition —
// but TodoOrderCommandHandler had no retry, so the loser's raw ConcurrencyException became a 409,
// which the client treats as a duplicate/no-op and silently drops (BUG-27's class).
//
// These lock in the retry that NoteCommandHandler has always had.
public sealed class TodoOrderContentionTests
{
    [Fact]
    public async Task ReorderTodos_LosingASingleRace_RetriesAndPersists()
    {
        var store = new ConflictingEventStore();
        using var factory = new ApiFactory();
        var custom = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(sp => ApiFactory.BuildSyncProjectingStore(sp, store));
        }));
        var client = custom.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        var a = await CreateTodoAsync(client, "A");
        var b2 = await CreateTodoAsync(client, "B");

        // The first append loses, exactly as the paired today-line write would make it lose.
        store.ConflictsRemaining = 1;
        var resp = await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { b2, a } });

        resp.EnsureSuccessStatusCode();
        Assert.Equal(new[] { b2, a }, await OpenItemIdsAsync(client));
    }

    [Fact]
    public async Task SetTodayLine_LosingASingleRace_RetriesAndPersists()
    {
        var store = new ConflictingEventStore();
        using var factory = new ApiFactory();
        var custom = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(sp => ApiFactory.BuildSyncProjectingStore(sp, store));
        }));
        var client = custom.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        await CreateTodoAsync(client, "A");
        var b2 = await CreateTodoAsync(client, "B");

        // This is the half that loses in practice: it is dispatched second, so it reads before
        // the reorder's write lands and fails the version guard.
        store.ConflictsRemaining = 1;
        var resp = await client.PostAsJsonAsync("/todos/today-line", new { anchorItemId = b2 });

        resp.EnsureSuccessStatusCode();
        Assert.Equal(b2, await GetTodayLineAsync(client));
    }

    [Fact]
    public async Task PersistentContention_OnOrderingWrite_Returns503Retriable_Not409()
    {
        var store = new ConflictingEventStore();
        using var factory = new ApiFactory();
        var custom = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(sp => ApiFactory.BuildSyncProjectingStore(sp, store));
        }));
        var client = custom.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        var a = await CreateTodoAsync(client, "A");
        var b2 = await CreateTodoAsync(client, "B");

        store.ConflictsRemaining = int.MaxValue;
        var resp = await client.PostAsJsonAsync("/todos/reorder", new { orderedItemIds = new[] { b2, a } });

        // 503, never 409: a 409 is the client's "duplicate, ignore" signal and would drop the write.
        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
    }

    private static async Task<string> CreateTodoAsync(HttpClient client, string description)
    {
        var resp = await client.PostAsJsonAsync("/todos", new { description });
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("todoId").GetString()!;
    }

    private static async Task<string[]> OpenItemIdsAsync(HttpClient client)
    {
        var resp = await client.GetAsync("/todos");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return [.. body.GetProperty("items").EnumerateArray()
            .Where(i => i.GetProperty("completedAt").ValueKind == JsonValueKind.Null)
            .Select(i => i.GetProperty("itemId").GetString()!)];
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
