using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class ImplicitActionAddJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task Enter_key_adds_action_item_and_clears_input()
    {
        var title = $"Imp {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AddActionItemAsync("Send recap");

        await _app.AssertActionItemVisibleAsync("Send recap");
        await Assertions.Expect(_page.GetByTestId("action-input")).ToHaveValueAsync(string.Empty);
    }

    [Fact]
    public async Task Blur_adds_non_empty_action_item()
    {
        var title = $"Imp {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AddActionItemByBlurAsync("Book the room");

        await _app.AssertActionItemVisibleAsync("Book the room");
    }

    [Fact]
    public async Task No_add_button_is_visible()
    {
        var title = $"Imp {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AssertNoAddButtonAsync();
    }

    [Fact]
    public async Task Blur_on_empty_input_does_not_add_item()
    {
        var title = $"Imp {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _page.GetByTestId("action-input").BlurAsync();

        await _app.AssertActionsEmptyAsync();
    }
}
