using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// RYW-1: read-your-writes for "add a to-do". Runs against the DEPLOYED async projector,
// so the add never resolves to an inline read-model write — the consistency gate (the
// `If-Consistent-With` token on the todos refetch) is what makes this assertion
// deterministic. If the gate or the token plumbing regressed, the new to-do would race
// the projector and this journey would flake/fail.
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

        await _app.AssertTodoVisibleAsync(description);
    }
}
