using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class ActionItemJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Action_items_persist_across_navigation()
    {
        var title = $"Act {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AddActionItemAsync("Book meeting room");
        await _app.AddActionItemAsync("Send recap email");

        await _app.SaveAndReturnAsync();
        await _app.ClickNoteInListAsync(title);

        await _app.AssertActionItemVisibleAsync("Book meeting room");
        await _app.AssertActionItemVisibleAsync("Send recap email");
    }

    [Fact]
    public async Task Note_with_no_actions_shows_empty_state()
    {
        var title = $"Act {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AssertActionsEmptyAsync();
    }
}
