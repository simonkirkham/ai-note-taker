using Microsoft.Playwright;

namespace Browser.E2E.Pages;

public sealed class AppPage(IPage page, string baseUrl, string? authToken = null)
{
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

    // The note read-your-writes proof (RYW-2): reload FIRST (drops the optimistic cards cache, so
    // the renamed card can only come from the server), then assert. The post-reload GET /notes/cards
    // carries the sessionStorage-persisted note token, so the gate waits for the async projector and
    // the card appears deterministically. Reload-loop so a still-warming projector re-polls (each
    // reload re-sends the token and re-gates) rather than getting stuck on one stale fetch.
    public async Task AssertNoteVisibleInListAfterReloadAsync(string title, int timeoutMs = 20000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (true)
        {
            await page.ReloadAsync();
            try
            {
                await Assertions.Expect(
                    page.GetByTestId("note-cards")
                        .Locator("[data-testid='note-card']")
                        .Filter(new LocatorFilterOptions { HasText = title })
                ).ToBeVisibleAsync(new() { Timeout = 2500 });
                return;
            }
            catch (PlaywrightException) when (DateTime.UtcNow < deadline)
            {
                // re-loop: reload + recheck until the gated read returns the card or we time out
            }
        }
    }

    public async Task ClickNoteInListAsync(string title)
    {
        var card = page.GetByTestId("note-cards")
            .Locator("[data-testid='note-card']")
            .Filter(new LocatorFilterOptions { HasText = title });
        // The card list is projector-built (async) since RYW-2 — wait (re-gating on reload) for the
        // just-saved card to land before clicking it, else a still-catching-up projector yields an
        // empty/stale list and the click misses.
        await WaitVisibleWithReloadAsync(card);
        await card.Locator("[data-testid='note-card-title']").ClickAsync();
    }

    // Cards-list reads are async since RYW-2: a just-written card is projector-built, so the gated
    // read can return `stale` while the projector is still catching up (e.g. a cold first
    // invocation, slower than the gate's ~2s bound). Re-check, reloading to re-send the consistency
    // token and re-gate, until the locator is visible or the deadline — reloads ONLY while not yet
    // visible, so it costs nothing once the projector is warm.
    private async Task WaitVisibleWithReloadAsync(ILocator locator, int timeoutMs = 20000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (true)
        {
            try
            {
                await Assertions.Expect(locator).ToBeVisibleAsync(new() { Timeout = 2500 });
                return;
            }
            catch (PlaywrightException) when (DateTime.UtcNow < deadline)
            {
                await page.ReloadAsync();
            }
        }
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

    // RYW-1: add a standalone to-do via the home quick-capture input. Waits for the
    // POST /todos response so the write (and its consistency token) is committed before
    // we assert the list. The subsequent GET /todos carries the token, so the async
    // projector is gated to catch up — making the assertion deterministic.
    public async Task AddTodoAsync(string description)
    {
        var input = page.GetByPlaceholder("Add a to-do");
        await input.FillAsync(description);
        var postDone = page.WaitForResponseAsync(r => r.Url.Contains("/todos") && r.Request.Method == "POST");
        await input.PressAsync("Enter");
        await postDone;
    }

    public Task AssertTodoVisibleAsync(string description) =>
        Assertions.Expect(
            page.GetByTestId("todo-section").GetByText(description)
        ).ToBeVisibleAsync(new() { Timeout = 15000 });

    // The real read-your-writes proof: reload FIRST (drops the optimistic cache, so the
    // todo can only come from the server), then assert. The post-reload GET /todos carries
    // the sessionStorage-persisted token, so the gate waits for the async projector — the
    // todo appears deterministically. Reload-loop so a still-warming projector re-polls
    // (each reload re-sends the token and re-gates) rather than getting stuck on one stale fetch.
    public async Task AssertTodoVisibleAfterReloadAsync(string description, int timeoutMs = 20000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (true)
        {
            await page.ReloadAsync();
            try
            {
                await Assertions.Expect(
                    page.GetByTestId("todo-section").GetByText(description)
                ).ToBeVisibleAsync(new() { Timeout = 2500 });
                return;
            }
            catch (PlaywrightException) when (DateTime.UtcNow < deadline)
            {
                // re-loop: reload + recheck until the gated read returns the todo or we time out
            }
        }
    }

    // Reload-tolerant: the card's tag pill is projector-built (async) since RYW-2, so the post-save
    // gated read can be `stale` on a cold projector — reload to re-gate until the pill shows.
    public Task AssertCardTagVisibleAfterReloadAsync(string cardTitle, string tag) =>
        WaitVisibleWithReloadAsync(
            page.GetByTestId("note-cards")
                .Locator("[data-testid='note-card']")
                .Filter(new LocatorFilterOptions { HasText = cardTitle })
                .GetByTestId($"card-tag-{tag}"));
}
