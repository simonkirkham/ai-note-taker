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
        var patchDone = page.WaitForResponseAsync(r => r.Url.Contains("/title") && r.Request.Method == "PATCH");
        await input.BlurAsync();
        await patchDone;
    }

    public Task GoBackAsync() =>
        page.GetByTestId("back-button").ClickAsync();

    public Task AssertNoteVisibleInListAsync(string title) =>
        Assertions.Expect(
            page.GetByTestId("note-list").GetByText(title)
        ).ToBeVisibleAsync();

    public Task ClickNoteInListAsync(string title) =>
        page.GetByTestId("note-list").GetByText(title).ClickAsync();

    public Task AssertContentAreaVisibleAsync() =>
        Assertions.Expect(page.GetByTestId("note-content")).ToBeVisibleAsync();

    public Task AssertContentValueAsync(string expected) =>
        Assertions.Expect(page.GetByTestId("note-content")).ToHaveValueAsync(expected);

    public async Task EnterContentAsync(string content)
    {
        var textarea = page.GetByTestId("note-content");
        var putDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/content") && r.Request.Method == "PUT");
        await textarea.FillAsync(content);
        await textarea.BlurAsync();
        await putDone;
    }

    public async Task DeleteNoteAsync()
    {
        var deleteDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/notes/") && r.Request.Method == "DELETE");
        await page.GetByTestId("delete-note-button").ClickAsync();
        await deleteDone;
    }

    public Task AssertNoteAbsentFromListAsync(string title) =>
        Assertions.Expect(
            page.GetByTestId("note-list").GetByText(title)
        ).Not.ToBeVisibleAsync();

    public async Task AddActionItemAsync(string description)
    {
        var input = page.GetByTestId("action-input");
        await input.FillAsync(description);
        var postDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/actions") && r.Request.Method == "POST");
        await page.GetByTestId("add-action-button").ClickAsync();
        await postDone;
    }

    public Task AssertActionItemVisibleAsync(string description) =>
        Assertions.Expect(page.GetByTestId("actions-list").GetByText(description)).ToBeVisibleAsync();

    public Task AssertActionsEmptyAsync() =>
        Assertions.Expect(page.GetByTestId("actions-empty")).ToBeVisibleAsync();
}
