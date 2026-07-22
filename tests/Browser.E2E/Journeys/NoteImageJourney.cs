using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class NoteImageJourney(BrowserFixture browser) : IAsyncLifetime
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
        _app = new AppPage(_page, browser.FrontendUrl, browser.E2EAuthToken);
    }

    public async Task DisposeAsync()
    {
        await _context.Tracing.StopAsync(new() { Path = "trace.zip" });
        await _context.DisposeAsync();
    }

    // A 1x1 transparent PNG — smallest valid image payload to exercise the upload path.
    private static readonly byte[] PngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    // A 600x80 solid PNG — natural width comfortably wider than the "Small" preset (240)
    // so a clamp-to-preset resize is observable (the 1x1 above would clamp every preset to 1px).
    private static readonly byte[] WidePngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAlgAAABQCAIAAABKyJzPAAABEElEQVR42u3VMQ0AAAgEsReGMCQiCxkMNKmCWy7VAwBvRQIAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAjBAAI1QBACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEACMEgCsLIANiS0+RAPsAAAAASUVORK5CYII=");

    [E2EFact]
    public async Task Pick_an_image_see_it_inline_and_it_survives_reload()
    {
        var title = $"Image note {Guid.NewGuid():N}"[..30];

        // Given a fresh note with a title
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        // When I pick an image via the file-picker
        var presignDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/presign-upload") && r.Request.Method == "POST");
        await _page.GetByTestId("image-file-input").SetInputFilesAsync(new FilePayload
        {
            Name = "shot.png",
            MimeType = "image/png",
            Buffer = PngBytes,
        });
        await presignDone;

        // Then it appears inline in the editor
        var editorImage = _page.GetByTestId("note-content").Locator("img");
        await Assertions.Expect(editorImage).ToBeVisibleAsync(new() { Timeout = 15000 });

        // And after saving and reopening the note, the image still renders (resolved
        // from the persisted key to a fresh presigned URL).
        var contentSaved = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/content") && r.Request.Method == "PUT");
        await _app.SaveAndReturnAsync();
        await contentSaved;

        await _app.ClickNoteInListAsync(title);
        var resolveDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/resolve") && r.Request.Method == "POST");
        await resolveDone;
        await Assertions.Expect(
            _page.GetByTestId("note-content").Locator("img")
        ).ToBeVisibleAsync(new() { Timeout = 15000 });
    }

    [E2EFact]
    public async Task Opening_a_note_with_an_image_issues_no_bare_key_relative_image_request()
    {
        // BUG-24: stored content carries the bare key `notes/{id}/{img}.png`. Before the fix,
        // tiptap-markdown parsed that into a transient <img src="notes/…"> the browser fetched
        // relative to the SPA route (`…/notes/notes/…`) → 403, on every open. The fix mounts
        // the editor with keys stripped, then setContent's presigned URLs after resolve — so
        // the only image request on open is the presigned (`X-Amz-…`) GET, never a bare-key one.
        var title = $"No-403 img {Guid.NewGuid():N}"[..30];

        // Given a note whose persisted content contains an inline image (upload then save).
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        var presignDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/presign-upload") && r.Request.Method == "POST");
        await _page.GetByTestId("image-file-input").SetInputFilesAsync(new FilePayload
        {
            Name = "shot.png",
            MimeType = "image/png",
            Buffer = PngBytes,
        });
        await presignDone;
        await Assertions.Expect(_page.GetByTestId("note-content").Locator("img"))
            .ToBeVisibleAsync(new() { Timeout = 15000 });

        var contentSaved = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/content") && r.Request.Method == "PUT");
        await _app.SaveAndReturnAsync();
        await contentSaved;

        // When I reopen the note — record every image response while it loads.
        var badRequests = new List<string>();
        _page.Response += (_, response) =>
        {
            var url = response.Url;
            var isPng = url.Contains(".png", StringComparison.OrdinalIgnoreCase);
            var isPresigned = url.Contains("X-Amz-", StringComparison.OrdinalIgnoreCase);
            // A note-image PNG under a `/notes/` path fetched without a presign is the bare-key
            // relative-URL request (e.g. the BUG-24 doubled-segment `…/notes/notes/{id}/{img}.png`).
            var isBareKeyImage = isPng && !isPresigned && url.Contains("/notes/");
            if (isBareKeyImage && response.Status >= 400)
                badRequests.Add($"{response.Status} {url}");
        };

        await _app.ClickNoteInListAsync(title);
        var resolveDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/resolve") && r.Request.Method == "POST");
        await resolveDone;
        await Assertions.Expect(_page.GetByTestId("note-content").Locator("img"))
            .ToBeVisibleAsync(new() { Timeout = 15000 });

        // Then no bare-key/relative image request was made (only the presigned GET).
        Assert.True(badRequests.Count == 0,
            $"Expected no bare-key image request on open; saw: {string.Join("; ", badRequests)}");
    }

    // BUG-31: removing an inline image persists (BUG-18) and stays gone after reopen. Previously
    // quarantined; the last flake cause was NOT a slow load but the note reading *blank* after the
    // removal: the note held ONLY the image, so removing it left content empty, and a stale
    // note-detail refetch could transiently blank the title too → hasContent=false → the header
    // renders `cancel-button` INSTEAD OF `save-button` (by design — NoteView.test.tsx blank-note
    // cases), so SaveAndReturnAsync's `save-button` click never resolved (30 s timeout, deploy #697).
    // Fix: the note also carries durable body TEXT. `content = contentDraft ?? detail.content`, and
    // the draft pattern shields a non-null contentDraft from a refetch clobber — so after removing
    // the image the local contentDraft is the surviving text (non-empty) → hasContent stays true →
    // save-button stays present, immune to the stale detail read. Reopen uses the reload-tolerant
    // convergence wait (a cold-projector reopen no longer misses the 15 s window). The residual
    // stale-refetch-blanks-an-existing-note's-title is filed separately (BUG-48).
    [E2EFact]
    public async Task Remove_an_image_drops_it_from_the_note_and_it_stays_gone_after_reload()
    {
        var title = $"Remove img {Guid.NewGuid():N}"[..30];
        const string bodyText = "Keep this line after the image is removed";

        // Given a note whose *persisted* content is durable body text PLUS an inline image
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        // Type the body text first, into the empty editor (safe — no image node to select), then a
        // newline so the image lands on its own line. This text is what keeps the note non-blank
        // once the image is removed, so the leave control stays "Save" regardless of detail-read lag.
        var editor = _page.GetByTestId("note-content");
        await editor.ClickAsync();
        await editor.PressSequentiallyAsync(bodyText);
        await _page.Keyboard.PressAsync("Enter");

        // A normally-sized image (not the 1x1 PngBytes): the 28-B corner resize handle is
        // 14px, so on a 1x1 image it blankets the whole image and intercepts the HoverAsync
        // below (which targets the image centre). A wide image keeps the handle in the far
        // corner, clear of the centre — matches why the resize test uses WidePngBytes.
        var presignDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/presign-upload") && r.Request.Method == "POST");
        await _page.GetByTestId("image-file-input").SetInputFilesAsync(new FilePayload
        {
            Name = "wide.png",
            MimeType = "image/png",
            Buffer = WidePngBytes,
        });
        await presignDone;

        var editorImage = _page.GetByTestId("note-content").Locator("img");
        await Assertions.Expect(editorImage).ToBeVisibleAsync(new() { Timeout = 15000 });

        // Save with the image so its key lands in server content, then reopen — this is the
        // real BUG-18 scenario. (The original test removed an image that was never persisted,
        // so the removal PUT was a no-op against already-empty content and passed regardless.)
        var imageSaved = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/content") && r.Request.Method == "PUT");
        await _app.SaveAndReturnAsync();
        await imageSaved;

        // Reopen and wait (reload-tolerant) for the editor to be fully loaded — the body text AND
        // the resolved image visible — before editing. Reloading is safe here: no unsaved edit yet.
        await _app.ClickNoteInListAsync(title);
        await _app.AssertNoteImageVisibleAfterReloadAsync();
        await Assertions.Expect(_page.GetByTestId("note-content"))
            .ToContainTextAsync(bodyText, new() { Timeout = 15000 });

        // When I activate the image's remove control
        await editorImage.HoverAsync();
        await _page.GetByTestId("remove-image-button").ClickAsync();

        // Then the image is removed from the note body immediately, and the body text remains — so
        // the note is not blank and the leave control is still Save (this is what BUG-31 tripped on).
        await Assertions.Expect(editorImage).ToHaveCountAsync(0);
        await Assertions.Expect(_page.GetByTestId("note-content")).ToContainTextAsync(bodyText);
        await Assertions.Expect(_page.GetByTestId("save-button")).ToBeVisibleAsync();

        // And after saving and reopening, the removal persisted — the key was dropped from
        // server content (BUG-18: the save fires on leave even though removing the image
        // never blurred the editor).
        var contentSaved = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/content") && r.Request.Method == "PUT");
        await _app.SaveAndReturnAsync();
        await contentSaved;

        await _app.ClickNoteInListAsync(title);
        await _app.AssertNoteImageAbsentAfterReloadAsync();
    }

    [E2EFact]
    public async Task Resize_an_image_to_a_preset_and_the_size_survives_reload()
    {
        var title = $"Resize img {Guid.NewGuid():N}"[..30];

        // Given a note with a persisted inline image at its natural width
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        var presignDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/presign-upload") && r.Request.Method == "POST");
        await _page.GetByTestId("image-file-input").SetInputFilesAsync(new FilePayload
        {
            Name = "wide.png",
            MimeType = "image/png",
            Buffer = WidePngBytes,
        });
        await presignDone;

        var editorImage = _page.GetByTestId("note-content").Locator("img");
        await Assertions.Expect(editorImage).ToBeVisibleAsync(new() { Timeout = 15000 });

        // When I choose the "Small" preset from the image's size control
        await editorImage.HoverAsync();
        await _page.GetByTestId("image-size-small").ClickAsync();

        // Then it shrinks to the small preset immediately (optimistic — no save wait)
        await Assertions.Expect(editorImage).ToHaveJSPropertyAsync("clientWidth", 240);

        // And after saving and reopening, the size persisted (read-your-writes of the width)
        var contentSaved = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/content") && r.Request.Method == "PUT");
        await _app.SaveAndReturnAsync();
        await contentSaved;

        await _app.ClickNoteInListAsync(title);
        var resolveDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/resolve") && r.Request.Method == "POST");
        await resolveDone;
        var reopened = _page.GetByTestId("note-content").Locator("img");
        await Assertions.Expect(reopened).ToBeVisibleAsync(new() { Timeout = 15000 });
        await Assertions.Expect(reopened).ToHaveJSPropertyAsync("clientWidth", 240);
    }

    [E2EFact]
    public async Task Drag_resize_an_image_and_the_size_survives_reload()
    {
        var title = $"Drag img {Guid.NewGuid():N}"[..30];

        // Given a note with a persisted inline image at its natural width
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(title);

        var presignDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/presign-upload") && r.Request.Method == "POST");
        await _page.GetByTestId("image-file-input").SetInputFilesAsync(new FilePayload
        {
            Name = "wide.png",
            MimeType = "image/png",
            Buffer = WidePngBytes,
        });
        await presignDone;

        var editorImage = _page.GetByTestId("note-content").Locator("img");
        await Assertions.Expect(editorImage).ToBeVisibleAsync(new() { Timeout = 15000 });

        // When I drag the corner handle far inward (past the minimum width)
        await editorImage.HoverAsync();
        var handle = _page.GetByTestId("image-resize-handle");
        var box = await handle.BoundingBoxAsync();
        await _page.Mouse.MoveAsync(box!.X + box.Width / 2, box.Y + box.Height / 2);
        await _page.Mouse.DownAsync();
        await _page.Mouse.MoveAsync(box.X - 800, box.Y + box.Height / 2, new() { Steps = 10 });
        await _page.Mouse.UpAsync();

        // Then it clamps to the minimum width immediately (optimistic — no save wait;
        // a deterministic target regardless of the editor's content width)
        await Assertions.Expect(editorImage).ToHaveJSPropertyAsync("clientWidth", 48);

        // And after saving and reopening, the dragged size persisted (reusing 28-A's
        // width round-trip — this slice adds no new save/load code)
        var contentSaved = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/content") && r.Request.Method == "PUT");
        await _app.SaveAndReturnAsync();
        await contentSaved;

        await _app.ClickNoteInListAsync(title);
        var resolveDone = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/images/resolve") && r.Request.Method == "POST");
        await resolveDone;
        var reopened = _page.GetByTestId("note-content").Locator("img");
        await Assertions.Expect(reopened).ToBeVisibleAsync(new() { Timeout = 15000 });
        await Assertions.Expect(reopened).ToHaveJSPropertyAsync("clientWidth", 48);
    }
}
