using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class DiscussedTickJourney(BrowserFixture browser) : IAsyncLifetime
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

    // BUG-37: clicking the ✓ "Mark as discussed" tick on a heading did nothing. The editor
    // content (.contentInput, position:relative for inline images) is a positioned sibling in
    // the same stacking layer and, coming later in the DOM, painted over the absolutely-
    // positioned button — so the click landed on the heading underneath, not the button.
    // Unprovable in jsdom (no layout / hit-testing): a normal ClickAsync on the OLD code times
    // out with "<h2> … intercepts pointer events"; the z-index fix makes the click land and
    // strike the topic. This journey is that real-browser proof.
    [E2EFact]
    public async Task Clicking_the_tick_strikes_through_a_heading()
    {
        var title = $"Discussed {Guid.NewGuid():N}"[..20];

        // Given a new note open in the editor
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        // And a heading typed via the markdown shortcut (caret lands inside it)
        var content = _page.GetByTestId("note-content");
        await content.ClickAsync();
        await content.PressSequentiallyAsync("## Agenda topic");

        // Then the floating ✓ is shown for the heading
        var tick = _page.GetByLabel("Mark as discussed");
        await Assertions.Expect(tick).ToBeVisibleAsync();

        // When the user clicks it — the click must reach the button, not the heading behind it
        await tick.ClickAsync();

        // Then the heading renders struck through (marked as discussed)
        await Assertions.Expect(content.Locator("h2 s")).ToBeVisibleAsync();
    }
}
