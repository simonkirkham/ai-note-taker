using Microsoft.Playwright;

namespace Browser.E2E.Pages;

public sealed class AppPage(IPage page, string baseUrl, string? authToken = null)
{
    // Tag pills render optimistically, but a cold post-deploy stack (cold Lambda +
    // cold on-demand tables) can let a note-detail refetch transiently overwrite the
    // optimistic pill with not-yet-consistent server state; it re-settles only once
    // the POST /tags + projection catch up. Give that window room: the old budgets
    // (15s explicit assert, 30s implicit click auto-wait) both raced cold-start
    // latency and flaked TagsJourney (a different test each run). 45s clears the 15s
    // failures with 3x margin and beats the observed 30s case.
    private const float TagPillTimeoutMs = 45000;

    public async Task GotoAsync()
    {
        if (!string.IsNullOrEmpty(authToken))
            await page.AddInitScriptAsync($"window.__E2E_AUTH_TOKEN = '{authToken}';");
        await page.GotoAsync(baseUrl);
    }

    // Hard-load a path under the app origin (e.g. "/notes/abc") — exercises the
    // CloudFront SPA rewrite, not just in-app client navigation.
    public async Task GotoPathAsync(string path)
    {
        if (!string.IsNullOrEmpty(authToken))
            await page.AddInitScriptAsync($"window.__E2E_AUTH_TOKEN = '{authToken}';");
        await page.GotoAsync($"{baseUrl.TrimEnd('/')}{path}");
    }

    // Hard-load an absolute URL (e.g. a captured note URL) as a fresh navigation.
    public async Task GotoUrlAsync(string url)
    {
        if (!string.IsNullOrEmpty(authToken))
            await page.AddInitScriptAsync($"window.__E2E_AUTH_TOKEN = '{authToken}';");
        await page.GotoAsync(url);
    }

    public string CurrentUrl => page.Url;

    public Task AssertHomeLoadedAsync() =>
        Assertions.Expect(page.GetByTestId("new-note-button")).ToBeVisibleAsync();

    public Task AssertNoteScreenLoadedAsync() =>
        Assertions.Expect(page.GetByTestId("note-title-input")).ToBeVisibleAsync();

    public async Task ClickNewNoteAsync()
    {
        var viewport = page.ViewportSize;
        if (viewport is { Width: < 640 })
            await page.GetByTestId("sidebar-toggle").ClickAsync();
        var noteDone = page.WaitForResponseAsync(r => r.Url.Contains("/notes") && r.Request.Method == "POST");
        await page.GetByTestId("new-note-button").ClickAsync();
        await noteDone;
    }

    public async Task EnterTitleAsync(string title)
    {
        var input = page.GetByTestId("note-title-input");
        await input.FillAsync(title);
        var patchDone = page.WaitForResponseAsync(r => r.Url.Contains("/title") && r.Request.Method == "PATCH");
        await input.BlurAsync();
        await patchDone;
    }

    public async Task SaveAndReturnAsync()
    {
        var cardsRefreshed = page.WaitForResponseAsync(r => r.Url.Contains("/notes/cards"));
        await page.GetByTestId("save-button").ClickAsync();
        await cardsRefreshed;
    }

    public Task AssertNoteVisibleInListAsync(string title) =>
        Assertions.Expect(
            page.GetByTestId("note-cards")
                .Locator("[data-testid='note-card']")
                .Filter(new LocatorFilterOptions { HasText = title })
        ).ToBeVisibleAsync();

    public Task ClickNoteInListAsync(string title) =>
        page.GetByTestId("note-cards")
            .Locator("[data-testid='note-card']")
            .Filter(new LocatorFilterOptions { HasText = title })
            .Locator("[data-testid='note-card-title']")
            .ClickAsync();

    public async Task DeleteNoteAsync()
    {
        var deleteDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/notes/") && r.Request.Method == "DELETE");
        await page.GetByTestId("delete-note-button").ClickAsync();
        await deleteDone;
    }

    public Task AssertNoteAbsentFromListAsync(string title) =>
        Assertions.Expect(
            page.GetByTestId("note-cards")
                .Locator("[data-testid='note-card']")
                .Filter(new LocatorFilterOptions { HasText = title })
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
        ).ToBeVisibleAsync(new() { Timeout = TagPillTimeoutMs });

    public Task AssertTagPillAbsentAsync(string tag) =>
        Assertions.Expect(
            page.GetByTestId("tags-section").GetByTestId($"tag-pill-{tag}")
        ).Not.ToBeVisibleAsync();

    public async Task RemoveTagAsync(string tag)
    {
        var pillButton = page.GetByTestId("tags-section")
            .GetByTestId($"tag-pill-{tag}")
            .GetByRole(AriaRole.Button);
        // Wait for the (optimistic) pill to settle on the same generous budget as
        // AssertTagPillVisibleAsync before clicking — otherwise removal inherits the
        // default 15s and flakes on the cold-start pill-render race.
        await Assertions.Expect(pillButton).ToBeVisibleAsync(new() { Timeout = TagPillTimeoutMs });
        var deleteDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/tags/") && r.Request.Method == "DELETE");
        await pillButton.ClickAsync();
        await deleteDone;
    }

    public Task AssertCardTagVisibleAsync(string cardTitle, string tag) =>
        Assertions.Expect(
            page.GetByTestId("note-cards")
                .Locator("[data-testid='note-card']")
                .Filter(new LocatorFilterOptions { HasText = cardTitle })
                .GetByTestId($"card-tag-{tag}")
        ).ToBeVisibleAsync();
}
