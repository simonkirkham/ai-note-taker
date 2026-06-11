using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class CreateAndListNoteJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Create_a_note_name_it_and_see_it_in_the_list()
    {
        var title = $"Journey note {Guid.NewGuid():N}"[..30];

        // Given the note list is open
        await _app.GotoAsync();

        // When I create a note and give it a title
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.SaveAndReturnAsync();

        // Then the named note appears in the list
        await _app.AssertNoteVisibleInListAsync(title);
    }

    // Server-truth persistence (27-C2): reload drops all in-memory cache, so this proves
    // the deployed write+async-projector pipeline actually persisted and projected the
    // new note onto the cards list — not that the optimistic insert held. The bounded
    // poll absorbs the ~1-2s projector lag.
    [Fact]
    public async Task Created_note_persists_in_list_after_reload()
    {
        var title = $"Journey note {Guid.NewGuid():N}"[..30];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.SaveAndReturnAsync();

        await _app.ReloadAsync();

        await _app.AssertNoteVisibleInListAfterReloadAsync(title);
    }
}
