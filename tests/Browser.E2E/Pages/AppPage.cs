using Microsoft.Playwright;

namespace Browser.E2E.Pages;

public sealed class AppPage(IPage page, string baseUrl)
{
    public Task GotoAsync() => page.GotoAsync(baseUrl);

    public async Task ClickNewNoteAsync()
    {
        var viewport = page.ViewportSize;
        if (viewport is { Width: < 640 })
            await page.GetByTestId("sidebar-toggle").ClickAsync();
        await page.GetByTestId("new-note-button").ClickAsync();
    }

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
        await input.PressAsync("Enter");
        await postDone;
    }

    public Task AssertActionItemVisibleAsync(string description) =>
        Assertions.Expect(page.GetByTestId("actions-list").GetByText(description)).ToBeVisibleAsync();

    public Task AssertActionsEmptyAsync() =>
        Assertions.Expect(page.GetByTestId("actions-empty")).ToBeVisibleAsync();

    public async Task AddTagAsync(string tagInput)
    {
        var tagCount = tagInput.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
        var input = page.GetByTestId("tag-input");
        await input.FillAsync(tagInput);

        // WaitForResponseAsync handlers all fire on the same response event, so
        // N parallel tasks can resolve to the same single response. Use an atomic
        // counter instead so we require exactly N distinct POST /tags responses.
        int received = 0;
        var allDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        page.Response += Handler;

        await input.PressAsync("Enter");
        await allDone.Task;
        page.Response -= Handler;

        void Handler(object? _, IResponse r)
        {
            if (r.Url.Contains("/tags") && r.Request.Method == "POST")
                if (Interlocked.Increment(ref received) >= tagCount)
                    allDone.TrySetResult();
        }
    }

    public Task AssertTagPillVisibleAsync(string tag) =>
        Assertions.Expect(
            page.GetByTestId("tags-section").GetByTestId($"tag-pill-{tag}")
        ).ToBeVisibleAsync(new() { Timeout = 15000 });

    public Task AssertTagPillAbsentAsync(string tag) =>
        Assertions.Expect(
            page.GetByTestId("tags-section").GetByTestId($"tag-pill-{tag}")
        ).Not.ToBeVisibleAsync();

    public async Task RemoveTagAsync(string tag)
    {
        var deleteDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/tags/") && r.Request.Method == "DELETE");
        await page.GetByTestId("tags-section")
            .GetByTestId($"tag-pill-{tag}")
            .GetByRole(AriaRole.Button)
            .ClickAsync();
        await deleteDone;
    }

    public Task AssertCardTagVisibleAsync(string cardTitle, string tag) =>
        Assertions.Expect(
            page.GetByTestId("note-cards")
                .Locator(".note-card")
                .Filter(new LocatorFilterOptions { HasText = cardTitle })
                .GetByTestId($"card-tag-{tag}")
        ).ToBeVisibleAsync();

    public async Task CreateFolderAsync(string name)
    {
        var postDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/folders") && r.Request.Method == "POST");
        await page.GetByTestId("new-folder-button").ClickAsync();
        var input = page.GetByTestId("new-folder-input");
        await input.FillAsync(name);
        await input.PressAsync("Enter");
        await postDone;
    }

    public async Task CreateSubfolderAsync(string parentFolderName, string childName)
    {
        var postDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/folders") && r.Request.Method == "POST");
        var folderItem = page.GetByText(parentFolderName).First;
        await folderItem.HoverAsync();
        await page.GetByTestId("add-subfolder-button").First.DispatchEventAsync("click");
        var input = page.GetByTestId("subfolder-input").First;
        await input.FillAsync(childName);
        await input.PressAsync("Enter");
        await postDone;
    }

    public Task AssertFolderVisibleInSidebarAsync(string folderName) =>
        Assertions.Expect(page.GetByTestId("sidebar").GetByText(folderName)).ToBeVisibleAsync();
}
