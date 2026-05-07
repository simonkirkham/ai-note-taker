using E2E.Pages;
using Microsoft.Playwright;

namespace E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class TodoListJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Home_screen_shows_open_todo_items_from_all_notes()
    {
        var descA = $"TDL-A-{Guid.NewGuid():N}"[..25];
        var descB = $"TDL-B-{Guid.NewGuid():N}"[..25];

        await _app.GotoAsync();

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync($"Note-{Guid.NewGuid():N}"[..20]);
        await _app.AddActionItemAsync(descA);
        await _app.GoBackAsync();

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync($"Note-{Guid.NewGuid():N}"[..20]);
        await _app.AddActionItemAsync(descB);
        await _app.GoBackAsync();

        await _app.AssertTodoSectionVisibleAsync();
        await _app.AssertTodoItemVisibleAsync(descA);
        await _app.AssertTodoItemVisibleAsync(descB);
    }
}
