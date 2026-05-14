using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class DeleteActionJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Deleting_action_item_removes_it_from_note_and_home_screen()
    {
        var desc = $"DEL-{Guid.NewGuid():N}"[..25];
        var title = $"Note-{Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddActionItemAsync(desc);
        await _app.AssertActionItemVisibleAsync(desc);

        await _app.DeleteActionItemAsync(desc);
        await _app.AssertActionItemAbsentAsync(desc);

        await _app.GoBackAsync();
        await _app.AssertTodoItemGoneAsync(desc);
    }
}
