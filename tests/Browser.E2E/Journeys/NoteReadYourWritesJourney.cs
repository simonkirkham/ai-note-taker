using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// RYW-2: read-your-writes for the note flows. Runs against the DEPLOYED async projector (the note
// read models are built only off the stream, never inline). Create a note, rename it, then reload
// the cards list FIRST — the reload drops the optimistic cache, so the renamed card can only
// reappear via the server. The post-reload GET /notes/cards carries the sessionStorage-persisted
// consistency token, so the gate waits for the projector and the card appears deterministically.
// If the gate / token / projector regressed, the post-reload read would race and the renamed card
// would be missing → this fails.
[Collection("E2E Journeys")]
public sealed class NoteReadYourWritesJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Renamed_note_appears_in_the_cards_list()
    {
        var title = $"RYW note {Guid.NewGuid():N}"[..24];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.SaveAndReturnAsync();

        // Reload drops the optimistic card; the renamed card can only reappear via the token-gated
        // server read — the genuine read-your-writes proof against the deployed projector.
        await _app.AssertNoteVisibleInListAfterReloadAsync(title);
    }
}
