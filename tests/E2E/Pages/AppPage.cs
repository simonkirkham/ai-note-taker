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

    public async Task ToggleActionItemCompleteAsync(string description)
    {
        var responseDone = page.WaitForResponseAsync(r =>
            r.Request.Method == "POST" &&
            (r.Url.Contains("/complete") || r.Url.Contains("/reopen")));
        await page.GetByTestId("actions-list")
            .Locator("li")
            .Filter(new LocatorFilterOptions { HasText = description })
            .GetByRole(AriaRole.Checkbox)
            .ClickAsync();
        await responseDone;
    }

    public Task AssertActionItemCompletedAsync(string description) =>
        Assertions.Expect(
            page.GetByTestId("actions-list")
                .Locator("li")
                .Filter(new LocatorFilterOptions { HasText = description })
                .GetByRole(AriaRole.Checkbox)
        ).ToBeCheckedAsync();

    public Task AssertActionItemOpenAsync(string description) =>
        Assertions.Expect(
            page.GetByTestId("actions-list")
                .Locator("li")
                .Filter(new LocatorFilterOptions { HasText = description })
                .GetByRole(AriaRole.Checkbox)
        ).Not.ToBeCheckedAsync();

    public Task AssertTodoSectionVisibleAsync() =>
        Assertions.Expect(page.GetByTestId("todo-section")).ToBeVisibleAsync();

    public Task AssertTodoItemVisibleAsync(string description) =>
        Assertions.Expect(page.GetByTestId("todo-list").GetByText(description)).ToBeVisibleAsync();

    public async Task CompleteTodoItemAsync(string description)
    {
        var responseDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/complete") && r.Request.Method == "POST");
        await page.GetByTestId("todo-list")
            .Locator("li")
            .Filter(new LocatorFilterOptions { HasText = description })
            .GetByRole(AriaRole.Checkbox)
            .ClickAsync();
        await responseDone;
    }

    public Task AssertTodoItemGoneAsync(string description) =>
        Assertions.Expect(
            page.GetByTestId("todo-section").GetByText(description)
        ).Not.ToBeVisibleAsync();

    public async Task DeleteActionItemAsync(string description)
    {
        var responseDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/actions/") && r.Request.Method == "DELETE");
        await page.GetByTestId("actions-list")
            .Locator("li")
            .Filter(new LocatorFilterOptions { HasText = description })
            .GetByRole(AriaRole.Button)
            .ClickAsync();
        await responseDone;
    }

    public Task AssertActionItemAbsentAsync(string description) =>
        Assertions.Expect(
            page.GetByTestId("actions-list").GetByText(description)
        ).Not.ToBeVisibleAsync();

    public async Task SetNoteDateAsync(string isoDate)
    {
        var input = page.GetByTestId("note-date-input");
        var patchDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/date") && r.Request.Method == "PATCH");
        await input.FillAsync(isoDate);
        await input.BlurAsync();
        await patchDone;
    }

    public Task AssertNoteDateVisibleAsync(string displayDate) =>
        Assertions.Expect(page.GetByTestId("note-date-display")).ToHaveTextAsync(displayDate);

    public Task AssertNoteDateEmptyAsync() =>
        Assertions.Expect(page.GetByTestId("note-date-input")).ToHaveValueAsync(string.Empty);
}
