using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class NoteCardJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Home_screen_shows_card_for_each_note()
    {
        var title = $"Card {Guid.NewGuid():N}"[..22];
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.GoBackAsync();

        await _app.AssertNoteCardVisibleAsync(title);
    }

    [Fact]
    public async Task Card_shows_content_snippet()
    {
        var title = $"Card {Guid.NewGuid():N}"[..22];
        var content = "Quarterly review discussion notes from the team meeting.";
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.EnterContentAsync(content);
        await _app.GoBackAsync();

        await _app.AssertNoteCardSnippetVisibleAsync(title, content[..20]);
    }

    [Fact]
    public async Task Card_shows_open_action_items()
    {
        var title = $"Card {Guid.NewGuid():N}"[..22];
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddActionItemAsync("Send recap email");
        await _app.GoBackAsync();

        await _app.AssertNoteCardActionVisibleAsync(title, "Send recap email");
    }

    [Fact]
    public async Task EditNote_button_opens_the_note()
    {
        var title = $"Card {Guid.NewGuid():N}"[..22];
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.GoBackAsync();

        await _app.ClickEditNoteOnCardAsync(title);

        await _app.AssertContentAreaVisibleAsync();
    }

    [Fact]
    public async Task Deleted_note_card_disappears_from_home_screen()
    {
        var title = $"Card {Guid.NewGuid():N}"[..22];
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.DeleteNoteAsync();

        await _app.AssertNoteCardAbsentAsync(title);
    }
}
