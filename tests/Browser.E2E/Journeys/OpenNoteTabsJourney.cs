using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// Phase 49-A: several notes open at once. The proof a jsdom test cannot give — a real browser
// round trip through the router, with the address bar following the active tab.
//
// The journey is driven through the GATED home-card list (`/notes/cards`), never `/notes/search`
// (ungated → nothing to converge on → deploy-gate flake; CHANGE-23 / deploy #633). Each note is
// created and asserted one at a time so the reload-tolerant helper's single-note-under-assertion
// precondition holds (it re-gates on the LATEST note-write token).
//
// The tab assertions themselves are client-side state, so they need no reload tolerance.
[Collection("E2E Journeys")]
public sealed class OpenNoteTabsJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task OpenTwoNotes_SwitchBetweenTabs_CloseOne()
    {
        var first = $"Tab A {Guid.NewGuid():N}"[..20];
        var second = $"Tab B {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(first);
        await _app.SaveAndReturnAsync();
        await _app.AssertNoteVisibleInListAfterReloadAsync(first);

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(second);
        await _app.SaveAndReturnAsync();
        await _app.AssertNoteVisibleInListAfterReloadAsync(second);

        // Open the first note, then normalise: creating each fixture note above also opened
        // it, so start from exactly one tab rather than assuming a reload cleared them (it
        // does today; 49-B makes tabs survive a reload and would break that assumption).
        await _app.ClickNoteInListAsync(first);
        await _app.AssertNoteScreenLoadedAsync();
        await _app.CloseAllTabsExceptAsync(first);
        await _app.AssertOpenTabCountAsync(1);
        await _app.AssertActiveTabAsync(first);

        // Back to the list and open the second → the first stays open.
        await _app.GoBackAsync();
        await _app.AssertHomeLoadedAsync();
        await _app.ClickNoteInListAsync(second);
        await _app.AssertNoteScreenLoadedAsync();
        await _app.AssertOpenTabCountAsync(2);
        await _app.AssertOpenTabVisibleAsync(first);
        await _app.AssertActiveTabAsync(second);
        var secondUrl = _app.CurrentUrl;

        // Switching tabs shows the other note and moves the address bar with it.
        await _app.ClickOpenNoteTabAsync(first);
        await _app.AssertActiveTabAsync(first);
        Assert.NotEqual(secondUrl, _app.CurrentUrl);

        // Closing the tab I am NOT looking at leaves me where I am.
        await _app.CloseOpenNoteTabAsync(second);
        await _app.AssertOpenTabCountAsync(1);
        await _app.AssertOpenTabAbsentAsync(second);
        await _app.AssertActiveTabAsync(first);
        await _app.AssertNoteScreenLoadedAsync();

        // Closing the last tab returns to the notes list, with no bar left behind.
        await _app.CloseOpenNoteTabAsync(first);
        await _app.AssertHomeLoadedAsync();
        await _app.AssertNoOpenTabBarAsync();
    }
}
