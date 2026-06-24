using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// CHANGE-23: a home filter set before opening a note must survive browser Back — the SPA stores
// filters in the URL (?q/?tag/?older), so Back replays the prior history entry with the filter intact.
// This is the real-browser proof a jsdom unit test cannot give (no genuine history-back + remount).
//
// The "show older notes" filter is used as the representative filter because it filters the GATED
// home-card list client-side, so the proof depends on no ungated async-search projection (which can
// lag past the reload window and flake the gate). The unit specs cover the URL mechanics of all four
// filters; this proves the end-to-end Back round trip on one of them.
[Collection("E2E Journeys")]
public sealed class FilterBackNavigationJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Filter_OpenNote_Back_RestoresFilter()
    {
        var title = $"Find {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.SaveAndReturnAsync();

        // The just-saved card is gated (cards projection) — wait reload-tolerantly so it's present
        // before we filter/click.
        await _app.AssertNoteVisibleInListAfterReloadAsync(title);

        // Apply the "show older" filter → writes ?older=1 to the URL.
        await _app.OpenHomeFiltersAsync();
        await _app.ToggleShowOlderAsync();

        // Open the (today-dated, still-visible) note. Opening pushes a history entry on top of the
        // filtered home, so Back will return to the ?older=1 entry.
        await _app.ClickNoteInListAsync(title);
        await _app.AssertNoteScreenLoadedAsync();

        // Browser Back → the SPA restores /?older=1.
        await _app.GoBackAsync();
        await _app.AssertHomeLoadedAsync();

        // The filters panel (local UI state) re-collapses on remount, but the filter itself is
        // URL-derived and still active — re-open the panel and confirm the box is still ticked.
        await _app.OpenHomeFiltersAsync();
        await _app.AssertShowOlderCheckedAsync();
    }
}
