using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class TagFilterJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task TagFilterPill_AppearsAfterTagAdded()
    {
        var title = $"TF {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddTagAsync("filtertest");
        await _app.GoBackAsync();

        await _app.AssertTagFilterPillVisibleAsync("filtertest");
    }

    [Fact]
    public async Task TagFilter_ClickingPill_FiltersCards()
    {
        var titleA = $"TFA {Guid.NewGuid():N}"[..20];
        var titleB = $"TFB {Guid.NewGuid():N}"[..20];
        var tag = $"ft{Guid.NewGuid():N}"[..8];

        await _app.GotoAsync();

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(titleA);
        await _app.AddTagAsync(tag);
        await _app.GoBackAsync();

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(titleB);
        await _app.GoBackAsync();

        await _app.AssertTagFilterPillVisibleAsync(tag);
        await _app.ClickTagFilterPillAsync(tag);

        await _app.AssertNoteCardVisibleAsync(titleA);
        await _app.AssertNoteCardAbsentAsync(titleB);
    }

    [Fact]
    public async Task TagFilter_ClearButton_ShowsAllCards()
    {
        var titleA = $"TFA {Guid.NewGuid():N}"[..20];
        var titleB = $"TFB {Guid.NewGuid():N}"[..20];
        var tag = $"ft{Guid.NewGuid():N}"[..8];

        await _app.GotoAsync();

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(titleA);
        await _app.AddTagAsync(tag);
        await _app.GoBackAsync();

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(titleB);
        await _app.GoBackAsync();

        await _app.ClickTagFilterPillAsync(tag);
        await _app.AssertNoteCardAbsentAsync(titleB);

        await _app.ClickTagFilterClearAsync();

        await _app.AssertNoteCardVisibleAsync(titleA);
        await _app.AssertNoteCardVisibleAsync(titleB);
    }

    [Fact]
    public async Task TagFilter_AndOrToggle_AppearsWithTwoTagsSelected()
    {
        var title = $"TF {Guid.NewGuid():N}"[..20];
        var tagA = $"fta{Guid.NewGuid():N}"[..6];
        var tagB = $"ftb{Guid.NewGuid():N}"[..6];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);
        await _app.AddTagAsync($"{tagA} {tagB}");
        await _app.GoBackAsync();

        await _app.AssertTagFilterPillVisibleAsync(tagA);
        await _app.AssertTagFilterPillVisibleAsync(tagB);

        await _app.ClickTagFilterPillAsync(tagA);
        await _app.ClickTagFilterPillAsync(tagB);

        await _app.AssertTagFilterModeAsync("AND");
        await _app.ClickTagFilterModeToggleAsync();
        await _app.AssertTagFilterModeAsync("OR");
    }
}
