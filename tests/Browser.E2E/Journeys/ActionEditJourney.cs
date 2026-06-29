using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// 39-A: edit an action item's text, read-your-writes against the DEPLOYED async projector. Create a
// note, add an action, edit its text, then reload the note FIRST — the reload drops the optimistic
// actions cache, so the edited text can only reappear via the server. The post-reload
// GET /notes/{id}/actions carries the sessionStorage-persisted consistency token (the edit returns a
// fresh X-Consistency-Token), so the gate waits for the projector and the new text appears
// deterministically. If the edit handler/projection/token regressed, the post-reload read would race
// and show the old text → this fails.
[Collection("E2E Journeys")]
public sealed class ActionEditJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Edited_action_text_appears_after_reload()
    {
        var original = $"Edit me {Guid.NewGuid():N}"[..24];
        var edited = $"Edited {Guid.NewGuid():N}"[..24];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.AddActionItemAsync(original);

        // Reconcile the optimistic add to its real server id BEFORE editing. The add renders the row
        // with a temp id (`temp-…`) and swaps it for the real id only on the onSettled refetch; in the
        // slow deploy env that lag means an immediate edit would PUT to `/actions/temp-…` → 404 → the
        // edit is silently rolled back and the new text never appears (the deterministic failure this
        // journey hit). Reloading first re-reads the action from the server with its real id (CLAUDE.md:
        // drive a post-write action through a gated read, not optimistic state).
        await _app.AssertActionVisibleAfterReloadAsync(original);

        await _app.EditActionItemAsync(original, edited);

        // Reload drops the optimistic edit; the new text can only reappear via the token-gated server
        // read — the genuine read-your-writes proof against the deployed projector.
        await _app.AssertActionVisibleAfterReloadAsync(edited);
    }
}
