using E2E.Pages;
using Microsoft.Playwright;

namespace E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class NoteDateDefaultsJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task NewNote_DateInputShowsToday()
    {
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();

        await _app.AssertDateInputValueAsync(today);
    }

    [Fact]
    public async Task NewNote_NoFormattedDateLabelVisible()
    {
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();

        await _app.AssertDateDisplayAbsentAsync();
    }

    [Fact]
    public async Task NewNote_DatePersistsAfterNavigation()
    {
        var title = $"DateDefault-{Guid.NewGuid():N}"[..20];
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.GoBackAsync();
        await _app.ClickNoteInListAsync(title);

        await _app.AssertDateInputValueAsync(today);
    }
}
