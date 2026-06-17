using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// RYW-3b: read-your-writes for the folder flows. Runs against the DEPLOYED async projector (the
// folder tree is built only off the stream, never inline). Create a folder, then reload FIRST — the
// reload drops the optimistic folder tree, so the new folder can only reappear via the server. The
// post-reload GET /folders carries the sessionStorage-persisted consistency token, so the gate
// waits for the projector and the folder appears deterministically. If the gate / token / projector
// regressed, the post-reload read would race and the folder would be missing → this fails.
[Collection("E2E Journeys")]
public sealed class FolderReadYourWritesJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Created_folder_appears_after_reload()
    {
        var name = $"RYW folder {Guid.NewGuid():N}"[..22];

        await _app.GotoAsync();
        await _app.AddFolderAsync(name);

        // Reload drops the optimistic folder; it can only reappear via the token-gated server read —
        // the genuine read-your-writes proof against the deployed projector.
        await _app.AssertFolderVisibleAfterReloadAsync(name);
    }
}
