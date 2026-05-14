using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class NoteLayoutJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Captured_notes_label_is_visible_on_note_screen()
    {
        var title = $"Lay {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AssertCapturedNotesLabelVisibleAsync();
    }

    [Fact]
    public async Task Actions_panel_is_to_the_right_of_content_on_desktop()
    {
        await _page.SetViewportSizeAsync(1280, 800);
        var title = $"Lay {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddActionItemAsync("Prepare slides");

        await _app.AssertActionsPanelRightOfContentAsync();
    }

    [Fact]
    public async Task Actions_panel_stacks_below_content_on_narrow_screens()
    {
        await _page.SetViewportSizeAsync(375, 812);
        var title = $"Lay {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddActionItemAsync("Follow up");

        await _app.AssertActionsPanelBelowContentAsync();
    }

    [Fact]
    public async Task Action_item_operations_work_in_new_layout()
    {
        var title = $"Lay {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AddActionItemAsync("Send summary");
        await _app.AssertActionItemVisibleAsync("Send summary");

        await _app.ToggleActionItemCompleteAsync("Send summary");
        await _app.AssertActionItemCompletedAsync("Send summary");

        await _app.DeleteActionItemAsync("Send summary");
        await _app.AssertActionItemAbsentAsync("Send summary");
    }
}
