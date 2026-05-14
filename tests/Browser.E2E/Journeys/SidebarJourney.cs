using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class SidebarJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Note_names_appear_in_sidebar_on_home_screen()
    {
        var title = $"Sid {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.GoBackAsync();

        await _app.AssertSidebarVisibleAsync();
        await _app.AssertNoteVisibleInListAsync(title);
    }

    [Fact]
    public async Task Clicking_sidebar_entry_opens_the_note()
    {
        var title = $"Sid {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.GoBackAsync();

        await _app.ClickNoteInListAsync(title);

        await _app.AssertContentAreaVisibleAsync();
    }

    [Fact]
    public async Task Sidebar_is_visible_on_note_screen()
    {
        var title = $"Sid {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AssertSidebarVisibleAsync();
    }

    [Fact]
    public async Task Active_note_is_highlighted_in_sidebar()
    {
        var title = $"Sid {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AssertActiveNoteHighlightedInSidebarAsync(title);
    }

    [Fact]
    public async Task New_note_appears_in_sidebar_immediately()
    {
        var title = $"Sid {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AssertNoteVisibleInListAsync(title);
    }
}
