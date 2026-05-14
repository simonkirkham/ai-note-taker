using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class TagsJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task AddTag_PillAppearsOnNoteScreen()
    {
        var title = $"Tag {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AddTagAsync("1:1s");

        await _app.AssertTagPillVisibleAsync("1:1s");
    }

    [Fact]
    public async Task AddTag_PillAppearsOnHomeCard()
    {
        var title = $"Tag {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddTagAsync("1:1s");

        await _app.GoBackAsync();

        await _app.AssertCardTagVisibleAsync(title, "1:1s");
    }

    [Fact]
    public async Task AddTag_PersistsAfterNavigation()
    {
        var title = $"Tag {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddTagAsync("1:1s");

        await _app.GoBackAsync();
        await _app.ClickNoteInListAsync(title);

        await _app.AssertTagPillVisibleAsync("1:1s");
    }

    [Fact]
    public async Task AddMultipleTags_SpaceSeparated()
    {
        var title = $"Tag {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        await _app.AddTagAsync("1:1s Bill");

        await _app.AssertTagPillVisibleAsync("1:1s");
        await _app.AssertTagPillVisibleAsync("Bill");
    }

    [Fact]
    public async Task RemoveTag_PillDisappears()
    {
        var title = $"Tag {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddTagAsync("1:1s Bill");

        await _app.RemoveTagAsync("Bill");

        await _app.AssertTagPillVisibleAsync("1:1s");
        await _app.AssertTagPillAbsentAsync("Bill");
    }

    [Fact]
    public async Task RemoveTag_GoneAfterNavigation()
    {
        var title = $"Tag {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddTagAsync("1:1s Bill");
        await _app.RemoveTagAsync("Bill");

        await _app.GoBackAsync();
        await _app.ClickNoteInListAsync(title);

        await _app.AssertTagPillVisibleAsync("1:1s");
        await _app.AssertTagPillAbsentAsync("Bill");
    }
}
