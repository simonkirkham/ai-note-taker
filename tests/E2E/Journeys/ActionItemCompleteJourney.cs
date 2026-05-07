using E2E.Pages;
using Microsoft.Playwright;

namespace E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class ActionItemCompleteJourney(BrowserFixture browser) : IAsyncLifetime
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
        _app = new AppPage(_page, browser.FrontendUrl);
    }

    public async Task DisposeAsync()
    {
        await _context.Tracing.StopAsync(new() { Path = "trace.zip" });
        await _context.DisposeAsync();
    }

    [Fact]
    public async Task Completing_action_item_persists_across_navigation()
    {
        var title = $"Cmp {Guid.NewGuid():N}"[..20];
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddActionItemAsync("Chase invoice");

        await _app.ToggleActionItemCompleteAsync("Chase invoice");

        await _app.GoBackAsync();
        await _app.ClickNoteInListAsync(title);

        await _app.AssertActionItemCompletedAsync("Chase invoice");
    }

    [Fact]
    public async Task Reopening_completed_action_item_shows_as_open_after_navigation()
    {
        var title = $"Cmp {Guid.NewGuid():N}"[..20];
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddActionItemAsync("Chase invoice");

        await _app.ToggleActionItemCompleteAsync("Chase invoice");
        await _app.ToggleActionItemCompleteAsync("Chase invoice");

        await _app.GoBackAsync();
        await _app.ClickNoteInListAsync(title);

        await _app.AssertActionItemOpenAsync("Chase invoice");
    }
}
