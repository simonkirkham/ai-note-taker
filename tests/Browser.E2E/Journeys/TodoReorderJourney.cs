using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// 37-A: drag-to-reorder of the home To Do list, persisted per workspace. Runs against the DEPLOYED
// async projector (TodoListReordered is built only off the stream). The assertion reloads FIRST,
// dropping the optimistic order, so the new order can only come from the server — the post-reload
// GET /todos carries the order-stream consistency token, gating the projector to head. If the
// reorder event / projection / token regressed, the post-reload read would race and the order
// would be wrong → this fails. Keyboard Move (not raw drag) drives it so the journey is
// deterministic and proves the accessible reorder path.
[Collection("E2E Journeys")]
public sealed class TodoReorderJourney(BrowserFixture browser) : IAsyncLifetime
{
    private IBrowserContext _context = null!;
    private AppPage _app = null!;
    private IPage _page = null!;

    public async Task InitializeAsync()
    {
        _context = await browser.Browser.NewContextAsync();
        await _context.Tracing.StartAsync(new() { Screenshots = true, Snapshots = true, Sources = true });
        _page = await _context.NewPageAsync();
        _page.Console += (_, msg) => Console.WriteLine($"[browser {msg.Type}] {msg.Text}");
        _page.PageError += (_, err) => Console.WriteLine($"[browser error] {err}");
        _app = new AppPage(_page, browser.FrontendUrl, browser.E2EAuthToken);
    }

    public async Task DisposeAsync()
    {
        await _context.Tracing.StopAsync(new() { Path = "trace.zip" });
        await _context.DisposeAsync();
    }

    [E2EFact]
    public async Task Reordered_todos_persist_after_reload()
    {
        var first = $"AAA {Guid.NewGuid():N}"[..16];
        var second = $"BBB {Guid.NewGuid():N}"[..16];

        await _app.GotoAsync();
        await _app.AddTodoAsync(first);
        await _app.AddTodoAsync(second);

        // Baseline order is AddedAt: first, then second. Move `second` up so the order becomes
        // [second, first], then prove it survived the server round-trip via the gated reload.
        await _app.MoveTodoUpAsync(second);
        await _app.AssertTodoOrderAfterReloadAsync(second, first);
    }
}
