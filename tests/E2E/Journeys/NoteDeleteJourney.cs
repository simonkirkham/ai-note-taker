using E2E.Pages;
using Microsoft.Playwright.Xunit;

namespace E2E.Journeys;

public sealed class NoteDeleteJourney(BrowserFixture browserFixture) : PageTest
{
    private AppPage CreateApp() => new(Page, Environment.GetEnvironmentVariable("FRONTEND_URL")
        ?? throw new InvalidOperationException("FRONTEND_URL is not set"));

    [Fact]
    public async Task Deleting_a_note_navigates_to_list_and_note_is_absent()
    {
        var title = $"Del {Guid.NewGuid():N}"[..20];
        var app = CreateApp();

        await app.GotoAsync();
        await app.ClickNewNoteAsync();
        await app.EnterTitleAsync(title);
        await app.DeleteNoteAsync();

        await app.AssertNoteAbsentFromListAsync(title);
    }

    [Fact]
    public async Task Deleted_note_is_not_in_list_after_navigating_back_manually()
    {
        var title = $"Del {Guid.NewGuid():N}"[..20];
        var app = CreateApp();

        await app.GotoAsync();
        await app.ClickNewNoteAsync();
        await app.EnterTitleAsync(title);
        await app.GoBackAsync();

        await app.AssertNoteVisibleInListAsync(title);

        await app.ClickNoteInListAsync(title);
        await app.DeleteNoteAsync();

        await app.AssertNoteAbsentFromListAsync(title);
    }
}
