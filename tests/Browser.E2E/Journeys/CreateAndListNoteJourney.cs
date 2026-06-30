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

    [E2EFact]
    public async Task Create_a_note_name_it_and_see_it_in_the_list()
    {
        var title = $"Journey note {Guid.NewGuid():N}"[..30];

        // Given the note list is open
        await _app.GotoAsync();

        // When I create a note and give it a title
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.SaveAndReturnAsync();

        // Then the named note appears in the list. Reload-tolerant (BUG-42): the post-create
        // GET /notes/cards can serve stale while the async projector folds the new card, so a bare
        // ToBeVisible races it. Reload + re-gate on the persisted note token until the card appears.
        await _app.AssertNoteVisibleInListAfterReloadAsync(title);
    }
}
