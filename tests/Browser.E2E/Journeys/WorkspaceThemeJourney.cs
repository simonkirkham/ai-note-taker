using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// 36-A — per-workspace theme. A non-default workspace persists its theme server-side; after a
// reload the gated GET /workspaces re-applies it to <html data-theme>. Driven through the gated
// workspaces read (consistency-token bounded), with a reload-tolerant assertion so a cold/lagged
// projector re-polls rather than hard-failing on one stale fetch.
[Collection("E2E Journeys")]
public sealed class WorkspaceThemeJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task SetWorkspaceTheme_PersistsAcrossReload()
    {
        await _app.GotoAsync();
        await _app.AssertHomeLoadedAsync();

        // A fresh non-default workspace stores its theme server-side (the default workspace would
        // keep the global localStorage theme instead).
        await _app.CreateWorkspaceAsync($"Theme {Guid.NewGuid():N}"[..14]);

        // plum is a dark theme that sets data-theme="plum" (teal is the :root default and clears it,
        // so it can't be asserted as an attribute) — pick it so the reload check has a value to gate on.
        await _app.SelectWorkspaceThemeAsync("plum");

        await _app.AssertHtmlThemeAfterReloadAsync("plum");
    }
}
