using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class FolderNavigationJourney(BrowserFixture browser) : IAsyncLifetime
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
    public async Task CreateFolder_AppearsInSidebar()
    {
        var folderName = $"FNJ-{Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.CreateFolderAsync(folderName);

        await _app.AssertFolderVisibleInSidebarAsync(folderName);
    }

    [Fact]
    public async Task CreateSubfolder_AppearsNested()
    {
        var parentName = $"FNJ-P-{Guid.NewGuid():N}"[..20];
        var childName = $"FNJ-C-{Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.CreateFolderAsync(parentName);
        await _app.CreateSubfolderAsync(parentName, childName);

        await _app.AssertFolderVisibleInSidebarAsync(childName);
    }
}
