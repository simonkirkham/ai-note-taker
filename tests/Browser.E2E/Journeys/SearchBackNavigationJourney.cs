using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// CHANGE-23: searching, opening a result, then pressing browser Back must return to the
// populated search — not a reset home view. The search term lives in the URL (?q=), so the
// SPA's Back history entry restores it. This is the real-browser proof that a jsdom unit test
// cannot give (jsdom has no genuine history-back + remount cycle).
[Collection("E2E Journeys")]
public sealed class SearchBackNavigationJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Search_OpenResult_Back_RestoresSearch()
    {
        var title = $"Find {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.SaveAndReturnAsync();

        // Search for the just-created note. Filling the box writes ?q=<title> to the URL.
        await _app.SearchAsync(title);
        // The search read is projector-built (async since RYW); ClickNoteInListAsync waits
        // reload-tolerantly, and each reload re-sends ?q so the search re-runs after reload.
        await _app.ClickNoteInListAsync(title);
        await _app.AssertNoteScreenLoadedAsync();

        // Browser Back → the SPA restores /?q=<title>; the search box (and its results) repopulate.
        await _app.GoBackAsync();

        await _app.AssertSearchQueryAsync(title);
        await _app.AssertNoteVisibleInListAsync(title);
    }
}
