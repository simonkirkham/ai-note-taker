using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// 50-B: move a to-do across the Today line from its actions menu, and prove the new position
// SURVIVES A RELOAD. The reload half is the point — it is 50-A's one acceptance criterion that
// never had an executed proof (the unit spec covers the write; only a reload shows the anchor
// coming back from the server instead of the optimistic cache). 50-A merged during the
// 2026-08-06 GitHub Actions outage, so this closes that gap rather than filing it separately.
[Collection("E2E Journeys")]
public sealed class TodayLineJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Moving_a_todo_to_later_survives_a_reload()
    {
        var description = $"Line todo {Guid.NewGuid():N}"[..24];

        await _app.GotoAsync();
        await _app.AddTodoAsync(description);
        // A new to-do lands at the top of the list, so it starts in Today. Settle it through the
        // gated read first — moving a row the server has not folded yet would race the projector.
        await _app.AssertTodoVisibleAfterReloadAsync(description);

        await _app.MoveTodoToLaterAsync(description);
        await _app.AssertTodoInLaterAsync(description);

        // The real assertion: reload drops the optimistic anchor, so the row can only still be
        // under "Later" if the line's position came back from the server.
        await _app.AssertTodoInLaterAfterReloadAsync(description);
    }
}
