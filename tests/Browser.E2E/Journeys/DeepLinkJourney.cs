using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// Phase 21-C — deep-linked note URLs survive a cold browser load (CloudFront
// SPA rewrite) and a stale link recovers to home.
[Collection("E2E Journeys")]
public sealed class DeepLinkJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Hard_loading_an_existing_note_url_opens_it()
    {
        var title = $"Deep {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        var noteUrl = _app.CurrentUrl; // /notes/<id>
        await _app.SaveAndReturnAsync();

        // A fresh navigation to the note URL must be served by the SPA rewrite
        // and open the note — i.e. the link is shareable/bookmarkable.
        await _app.GotoUrlAsync(noteUrl);
        await _app.AssertNoteScreenLoadedAsync();
    }

    [E2EFact]
    public async Task Hard_loading_a_missing_note_url_recovers_to_home()
    {
        // CloudFront serves the SPA for the unknown path; the app then 404s the
        // note fetch and redirects to the workspace home (21-C) rather than
        // dead-ending. The deep link is workspace-prefixed (23-D).
        await _app.GotoPathAsync($"/w/__default__/notes/missing-{Guid.NewGuid():N}");
        await _app.AssertHomeLoadedAsync();
    }
}
