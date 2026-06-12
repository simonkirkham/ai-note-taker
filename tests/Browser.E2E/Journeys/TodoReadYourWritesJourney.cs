using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// RYW-1: read-your-writes for "add a to-do". Runs against the DEPLOYED async projector
// (Todo is built only off the stream, never inline). The assertion reloads FIRST, which
// drops the optimistic row, so the to-do can only reappear via the server. The post-reload
// GET /todos carries the sessionStorage-persisted consistency token, so the gate waits for
// the projector and the to-do appears deterministically. If the gate / token / projector
// regressed, the post-reload read would race and the to-do would be missing → this fails.
[Collection("E2E Journeys")]
public sealed class TodoReadYourWritesJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Added_todo_appears_in_the_list()
    {
        var description = $"RYW todo {Guid.NewGuid():N}"[..24];

        await _app.GotoAsync();
        await _app.AddTodoAsync(description);

        // Reload drops the optimistic row; the to-do can only reappear via the token-gated
        // server read — the genuine read-your-writes proof against the deployed projector.
        await _app.AssertTodoVisibleAfterReloadAsync(description);
    }
}
