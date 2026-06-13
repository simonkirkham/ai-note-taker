using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// RYW-3a: read-your-writes for the action flows. Runs against the DEPLOYED async projector (the
// action read models are built only off the stream, never inline). Create a note, add an action,
// then reload the note FIRST — the reload drops the optimistic actions cache, so the new action can
// only reappear via the server. The post-reload GET /notes/{id}/actions carries the
// sessionStorage-persisted consistency token, so the gate waits for the projector and the action
// appears deterministically. If the gate / token / projector regressed, the post-reload read would
// race and the action would be missing → this fails.
[Collection("E2E Journeys")]
public sealed class ActionReadYourWritesJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Added_action_appears_after_reload()
    {
        var description = $"RYW action {Guid.NewGuid():N}"[..26];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.AddActionItemAsync(description);

        // Reload drops the optimistic action; it can only reappear via the token-gated server read —
        // the genuine read-your-writes proof against the deployed projector.
        await _app.AssertActionVisibleAfterReloadAsync(description);
    }
}
