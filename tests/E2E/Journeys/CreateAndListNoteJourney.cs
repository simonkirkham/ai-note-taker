using E2E.Pages;
using Microsoft.Playwright;

namespace E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class CreateAndListNoteJourney(BrowserFixture browser) : IAsyncLifetime
{
    private IBrowserContext _context = null!;
    private AppPage _app = null!;

    public async Task InitializeAsync()
    {
        _context = await browser.Browser.NewContextAsync();
        await _context.Tracing.StartAsync(new() { Screenshots = true, Snapshots = true, Sources = true });
        _app = new AppPage(await _context.NewPageAsync(), browser.FrontendUrl);
    }

    public async Task DisposeAsync()
    {
        await _context.Tracing.StopAsync(new() { Path = "trace.zip" });
        await _context.DisposeAsync();
    }

    [Fact]
    public async Task Create_a_note_name_it_and_see_it_in_the_list()
    {
        // Given the note list is open
        await _app.GotoAsync();

        // When I create a note and give it a title
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync("My journey note");
        await _app.GoBackAsync();

        // Then the named note appears in the list
        await _app.AssertNoteVisibleInListAsync("My journey note");
    }
}
