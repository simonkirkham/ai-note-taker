using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class ActionItemJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Action_items_persist_across_navigation()
    {
        var title = $"Act {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AddActionItemAsync("Book meeting room");
        await _app.AddActionItemAsync("Send recap email");

        await _app.SaveAndReturnAsync();
        await _app.ClickNoteInListAsync(title);

        // BUG-25: the actions read is async + token-gated since RYW-3a, so a reopen can race the
        // deployed projector's cold-start lag past the gate's ~2.6s bound. Reload-and-re-gate until
        // the action lands (deadline ~20s) rather than a single 5s locator wait — same hardening the
        // cards (#256) and tags (#265) journeys needed when their reads went async.
        await _app.AssertActionVisibleAfterReloadAsync("Book meeting room");
        await _app.AssertActionVisibleAfterReloadAsync("Send recap email");
    }

    [E2EFact]
    public async Task Note_with_no_actions_shows_empty_state()
    {
        var title = $"Act {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AssertActionsEmptyAsync();
    }
}
