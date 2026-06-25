using Microsoft.Playwright;

namespace Browser.E2E.Pages;

public sealed class AppPage
{
    private readonly IPage page;
    private readonly string baseUrl;
    private readonly string? authToken;

    // SAFE TI-42 diagnostic: record ONLY the synchronous .Url/.Status of cards reads. Never read the
    // body — `response.TextAsync()` hangs indefinitely on a response aborted by the reload loop, which
    // turns a clean 33 s flake-fail into a 44 min suite hang (PR #291). The recorded URL carries the
    // `/w/{wsId}/` workspace prefix the frontend actually requested — the most direct evidence for the
    // "cards read scoped to the wrong workspace on reload" hypothesis. Surfaced in the failure message.
    private readonly System.Collections.Concurrent.ConcurrentQueue<string> cardsRequestLog = new();

    public AppPage(IPage page, string baseUrl, string? authToken = null)
    {
        this.page = page;
        this.baseUrl = baseUrl;
        this.authToken = authToken;
        page.Response += (_, r) =>
        {
            if (r.Url.Contains("/notes/cards", StringComparison.OrdinalIgnoreCase))
                cardsRequestLog.Enqueue($"{r.Status} {r.Url}");
        };
    }

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
        // Click save → the note saves and the app navigates back to the home list. This previously
        // awaited a GET /notes/cards response as the "list ready" signal, but React Query can serve the
        // home list from cache → NO network request fires → a 30 s WaitForResponse timeout (the residual
        // BUG-31 flake: ~1/3 of post-removal saves). Wait on the navigation itself (the home "new note"
        // control, the same signal AssertHomeLoadedAsync trusts), which is independent of whether the
        // cards query refetches. Safe for every caller: the just-saved card is added optimistically, so
        // callers' own AssertNoteVisibleInList*/ClickNoteInList asserts (auto-waiting / reload-tolerant)
        // still see it; callers needing the persisted write await their own /content PUT separately.
        await page.GetByTestId("save-button").ClickAsync();
        await Assertions.Expect(page.GetByTestId("new-note-button")).ToBeVisibleAsync();
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
    public async Task AssertNoteVisibleInListAfterReloadAsync(string title, int timeoutMs = 30000)
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
            catch (PlaywrightException)
            {
                // Deadline exceeded — the TI-42 flake. Replace the opaque "locator not visible" timeout
                // with synchronous diagnostics (no body reads, no hang) so the failure tells us WHY.
                // Only Playwright timeouts get the enriched message; any other exception propagates raw.
                throw new Exception(await DescribeMissingCardAsync(title, timeoutMs));
            }
        }
    }

    // Hang-proof failure diagnostics for the cards list: reads only already-resolved page state plus
    // the URL-only request log. `page.Url` (SPA route) and the recorded `/w/{wsId}/notes/cards` request
    // URLs reveal whether the read was scoped to a non-`__default__` workspace; the rendered card titles
    // show what the server actually returned. All bounded — never reads a response body.
    private async Task<string> DescribeMissingCardAsync(string title, int timeoutMs)
    {
        var url = page.Url;
        IReadOnlyList<string> cardTitles;
        try
        {
            cardTitles = await page.GetByTestId("note-cards")
                .Locator("[data-testid='note-card-title']").AllTextContentsAsync();
        }
        catch (Exception ex)
        {
            cardTitles = new[] { $"<cards-unavailable: {ex.GetType().Name}>" };
        }

        var recentRequests = cardsRequestLog.TakeLast(5).ToList();
        return $"TI-42: card '{title}' not in cards list after {timeoutMs}ms. " +
               $"page.Url={url} | rendered cards({cardTitles.Count})=[{string.Join(" | ", cardTitles)}] | " +
               $"last cards requests=[{string.Join(" ;; ", recentRequests)}]";
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
    private async Task WaitVisibleWithReloadAsync(ILocator locator, int timeoutMs = 30000)
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

    // Hidden counterpart of WaitVisibleWithReloadAsync: re-gate a *removal* against a warming projector.
    // A persisted removal (the DELETE is awaited before this is called) means the gated read carrying
    // the highest token will eventually return without the element; reload to re-poll until it does, or
    // the deadline. Reloads ONLY while the element is still visible, so a clean removal costs no reload.
    private async Task WaitHiddenWithReloadAsync(ILocator locator, int timeoutMs = 30000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (true)
        {
            try
            {
                await Assertions.Expect(locator).Not.ToBeVisibleAsync(new() { Timeout = 2500 });
                return;
            }
            catch (PlaywrightException) when (DateTime.UtcNow < deadline)
            {
                await page.ReloadAsync();
            }
        }
    }

    // Reload-tolerant absence check for an inline note image after reopen. Note content is
    // projector-built (RYW-2), so the gated GET /notes/{id} can serve `stale` on a cold projector
    // and still show the just-removed image. Wait for the editor to mount first (so count==0 means
    // "no image", not "editor not rendered yet"), then assert no image; reload to re-send the token
    // and re-gate until the removal is reflected or the deadline. Reloads ONLY while an image is
    // still present, so a clean removal costs no reload.
    public async Task AssertNoteImageAbsentAfterReloadAsync(int timeoutMs = 30000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        var img = page.GetByTestId("note-content").Locator("img");
        while (true)
        {
            try
            {
                await Assertions.Expect(page.GetByTestId("note-title-input")).ToBeVisibleAsync(new() { Timeout = 2500 });
                await Assertions.Expect(img).ToHaveCountAsync(0, new() { Timeout = 2500 });
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

    // CHANGE-27: actions moved from the always-visible sidebar into a popover under the
    // Command Bar's "Actions" pill. Open it (idempotent: no-op if already open) before
    // touching action-input/actions-list/actions-empty. The popover stays open through
    // add/toggle/delete and after adding, so a single open covers a whole interaction.
    public async Task OpenActionsPopoverAsync()
    {
        var popover = page.GetByTestId("actions-popover");
        if (await popover.IsVisibleAsync())
            return;
        await page.GetByTestId("actions-pill").ClickAsync();
        await Assertions.Expect(popover).ToBeVisibleAsync();
    }

    public async Task AddActionItemAsync(string description)
    {
        await OpenActionsPopoverAsync();
        var input = page.GetByTestId("action-input");
        await input.FillAsync(description);
        var postDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/actions") && r.Request.Method == "POST");
        await input.PressAsync("Enter");
        await postDone;
    }

    public async Task AssertActionsEmptyAsync()
    {
        await OpenActionsPopoverAsync();
        await Assertions.Expect(page.GetByTestId("actions-empty")).ToBeVisibleAsync();
    }

    public async Task AddFolderAsync(string name)
    {
        var viewport = page.ViewportSize;
        if (viewport is { Width: < 640 })
            await page.GetByTestId("sidebar-toggle").ClickAsync();
        await page.GetByTestId("new-folder-button").ClickAsync();
        var input = page.GetByTestId("new-folder-input");
        await input.FillAsync(name);
        var postDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/folders") && r.Request.Method == "POST");
        await input.PressAsync("Enter");
        await postDone;
    }

    // The folder read-your-writes proof (RYW-3b): reload FIRST (drops the optimistic folder tree,
    // so the just-added folder can only come from the server), then assert. The post-reload
    // GET /folders carries the sessionStorage-persisted folder token, so the gate waits for the
    // async projector and the folder appears deterministically. Reload-loop so a still-warming
    // projector re-polls (each reload re-sends the token and re-gates).
    public async Task AssertFolderVisibleAfterReloadAsync(string name, int timeoutMs = 30000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (true)
        {
            await page.ReloadAsync();
            try
            {
                await Assertions.Expect(page.GetByTestId("sidebar").GetByText(name))
                    .ToBeVisibleAsync(new() { Timeout = 2500 });
                return;
            }
            catch (PlaywrightException) when (DateTime.UtcNow < deadline)
            {
            }
        }
    }

    // The action read-your-writes proof (RYW-3a): reload FIRST (drops the optimistic actions cache,
    // so the just-added action can only come from the server), then assert. The post-reload
    // GET /notes/{id}/actions carries the sessionStorage-persisted action token, so the gate waits
    // for the async projector and the action appears deterministically. Reload-loop so a still-
    // warming projector re-polls (each reload re-sends the token and re-gates).
    public async Task AssertActionVisibleAfterReloadAsync(string description, int timeoutMs = 30000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (true)
        {
            await page.ReloadAsync();
            try
            {
                // CHANGE-27: a reload closes the actions popover — re-open it before asserting.
                await page.GetByTestId("actions-pill").ClickAsync(new() { Timeout = 2500 });
                await Assertions.Expect(page.GetByTestId("actions-list").GetByText(description))
                    .ToBeVisibleAsync(new() { Timeout = 2500 });
                return;
            }
            catch (PlaywrightException) when (DateTime.UtcNow < deadline)
            {
            }
        }
    }

    public async Task AddTagAsync(string tagInput)
    {
        var tagCount = tagInput.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
        // CHANGE-27: the tag combobox is hidden behind the "＋ Tag" ghost button in the
        // Command Bar — reveal it before filling. No-op if already revealed.
        var input = page.GetByTestId("tag-input");
        if (!await input.IsVisibleAsync())
            await page.GetByTestId("add-tag-button").ClickAsync();
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

    // Applied tags are note-detail state, projector-built since RYW-2: the gated GET /notes/{id} can
    // return `stale` while the projector is still warming (cold first invocation, past the ~2s gate
    // bound), so a pill can be transiently missing. Reload to re-send the consistency token and
    // re-gate (the note lives at /notes/{id}, so a hard reload re-opens it from the server) — reloads
    // ONLY while the pill isn't yet visible, so the optimistic happy path costs no reload. This is the
    // TI-19 follow-up to the BUG-22 token fix: the fix makes the read carry the right token; this makes
    // a still-warming projector re-poll instead of hard-timing-out on one fetch.
    public Task AssertTagPillVisibleAsync(string tag) =>
        WaitVisibleWithReloadAsync(page.GetByTestId("tags-section").GetByTestId($"tag-pill-{tag}"));

    public Task AssertTagPillAbsentAsync(string tag) =>
        WaitHiddenWithReloadAsync(page.GetByTestId("tags-section").GetByTestId($"tag-pill-{tag}"));

    public async Task RemoveTagAsync(string tag)
    {
        var pill = page.GetByTestId("tags-section").GetByTestId($"tag-pill-{tag}");
        // The pill is projector-backed note-detail state (RYW-2). A stale gated read can transiently
        // drop a just-added pill — notably the 2nd of a multi-tag add (the BUG-22 token-slot race) —
        // so clicking straight away can hang ClickAsync to its 30s actionability timeout (the
        // RemoveTag_* deploy-gate flakes). Wait reload-tolerantly for the pill first (each reload
        // re-sends the consistency token and re-gates), then remove it. This is the action-side
        // counterpart to the reload-tolerant *asserts* — projector-backed clicks need it too.
        await WaitVisibleWithReloadAsync(pill);
        var deleteDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/tags/") && r.Request.Method == "DELETE");
        await pill.GetByRole(AriaRole.Button).ClickAsync();
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
    public async Task AssertTodoVisibleAfterReloadAsync(string description, int timeoutMs = 30000)
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

    // CHANGE-23: home filters live in the URL (?q/?tag/?older), so they survive a Back navigation.
    // The E2E proves this with the "show older notes" filter — it filters the GATED home-card list
    // client-side, so the proof needs no ungated async-search projection (which can lag past the
    // reload window and flake the gate). The checkbox's checked-state is pure URL-derived state.
    private ILocator ShowOlderCheckbox => page.GetByRole(AriaRole.Checkbox, new() { Name = "Show older notes" });

    public async Task OpenHomeFiltersAsync()
    {
        // The collapsed "Filters" control (accessible name "Filters"; the chevron span is aria-hidden).
        await page.GetByRole(AriaRole.Button, new() { Name = "Filters" }).ClickAsync();
    }

    public async Task ToggleShowOlderAsync()
    {
        await ShowOlderCheckbox.ClickAsync();
    }

    // Assert "show older" is ticked — the CHANGE-23 proof that the ?older=1 filter survives Back.
    // Auto-waits, tolerating the brief re-render after navigation. URL-derived, no projector read.
    public Task AssertShowOlderCheckedAsync() =>
        Assertions.Expect(ShowOlderCheckbox).ToBeCheckedAsync();

    // Browser Back (history.back). Distinct from a hard GotoPath — exercises the SPA's own
    // history entry, which carries the CHANGE-23 ?q/?tag/?older query string.
    public async Task GoBackAsync() => await page.GoBackAsync();

    // 36-A — per-workspace theme. Open the sidebar (mobile), open the workspace switcher, create a
    // fresh non-default workspace, and wait for the app to navigate into it (`/w/{id}`, not __default__).
    // A fresh workspace starts with no stored theme → teal (the :root default, no data-theme attr).
    public async Task CreateWorkspaceAsync(string name)
    {
        var viewport = page.ViewportSize;
        if (viewport is { Width: < 640 })
            await page.GetByTestId("sidebar-toggle").ClickAsync();
        await page.GetByTestId("workspace-switcher-trigger").ClickAsync();
        await page.GetByTestId("workspace-create").ClickAsync();
        var input = page.GetByLabel("New workspace name");
        await input.FillAsync(name);
        await input.PressAsync("Enter");
        // Navigation into the new workspace — URL leaves __default__ for a real workspace id.
        await page.WaitForURLAsync(u => u.Contains("/w/") && !u.Contains("__default__"));
    }

    // Pick a theme from the sidebar Theme picker, awaiting the per-workspace PATCH so the write (and
    // its X-Consistency-Token) is committed before we reload — the post-reload GET /workspaces carries
    // the token and gates on the projector. Records only the synchronous request URL/method.
    public async Task SelectWorkspaceThemeAsync(string theme)
    {
        var viewport = page.ViewportSize;
        if (viewport is { Width: < 640 })
            await page.GetByTestId("sidebar-toggle").ClickAsync();
        var patchDone = page.WaitForResponseAsync(r =>
            r.Url.Contains("/theme") && r.Request.Method == "PATCH");
        await page.GetByLabel("Theme").SelectOptionAsync(new SelectOptionValue { Value = theme });
        await patchDone;
    }

    // The per-workspace-theme read-your-writes proof: reload FIRST (drops the optimistically-applied
    // data-theme, so the attribute can only come back via the workspaces query), then assert. The
    // index.html bootstrap paints the GLOBAL theme first; the workspace theme is applied once the
    // gated GET /workspaces resolves (it carries the persisted consistency token, so it waits for the
    // async projector). Reload-loop so a still-warming projector re-polls until the attribute matches.
    public async Task AssertHtmlThemeAfterReloadAsync(string theme, int timeoutMs = 30000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (true)
        {
            await page.ReloadAsync();
            try
            {
                await Assertions.Expect(page.Locator("html")).ToHaveAttributeAsync(
                    "data-theme", theme, new() { Timeout = 2500 });
                return;
            }
            catch (PlaywrightException) when (DateTime.UtcNow < deadline)
            {
                // re-loop: reload + recheck until the gated workspaces read applies the theme or we time out
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
