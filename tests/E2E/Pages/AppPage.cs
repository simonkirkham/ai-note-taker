using Microsoft.Playwright;

namespace E2E.Pages;

public sealed class AppPage(IPage page, string baseUrl)
{
    public Task GotoAsync() => page.GotoAsync(baseUrl);

    public Task ClickNewNoteAsync() =>
        page.GetByTestId("new-note-button").ClickAsync();

    public async Task EnterTitleAsync(string title)
    {
        var input = page.GetByTestId("note-title-input");
        await input.FillAsync(title);
        await input.BlurAsync();
        // Wait for the rename PATCH to complete before the caller navigates away.
        await page.WaitForLoadStateAsync(LoadState.NetworkIdle);
    }

    public Task GoBackAsync() =>
        page.GetByTestId("back-button").ClickAsync();

    public Task AssertNoteVisibleInListAsync(string title) =>
        Assertions.Expect(
            page.GetByTestId("note-list").GetByText(title)
        ).ToBeVisibleAsync();
}
