using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class NoteTabsJourney(BrowserFixture browser) : IAsyncLifetime
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

    [Fact]
    public async Task Switching_tabs_replaces_the_panel_rather_than_stacking()
    {
        // Given a freshly opened note (defaults to the Quick notes tab)
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();

        var quick = _page.GetByTestId("note-tabpanel-quick");
        var transcript = _page.GetByTestId("note-tabpanel-transcript");

        // Then only the Quick notes panel is visible; the others are not stacked below
        await Assertions.Expect(quick).ToBeVisibleAsync();
        await Assertions.Expect(transcript).ToBeHiddenAsync();

        // When I switch to the Transcript tab
        await _page.GetByTestId("note-tab-transcript").ClickAsync();

        // Then the Transcript panel replaces Quick notes (Quick notes is hidden, not floating below)
        await Assertions.Expect(transcript).ToBeVisibleAsync();
        await Assertions.Expect(quick).ToBeHiddenAsync();
    }
}
