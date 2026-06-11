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

    [Fact]
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

    [Fact]
    public async Task Remove_an_image_drops_it_from_the_note_and_it_stays_gone_after_reload()
    {
        var title = $"Remove img {Guid.NewGuid():N}"[..30];

        // Given a fresh note with an inline image
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

        var editorImage = _page.GetByTestId("note-content").Locator("img");
        await Assertions.Expect(editorImage).ToBeVisibleAsync(new() { Timeout = 15000 });

        // When I activate the image's remove control
        await editorImage.HoverAsync();
        await _page.GetByTestId("remove-image-button").ClickAsync();

        // Then the image is removed from the note body immediately
        await Assertions.Expect(editorImage).ToHaveCountAsync(0);

        // And after saving and reopening, the image is still gone (its key was
        // dropped from content, so no resolve is needed and nothing renders).
        var contentSaved = _page.WaitForResponseAsync(r =>
            r.Url.Contains("/content") && r.Request.Method == "PUT");
        await _app.SaveAndReturnAsync();
        await contentSaved;

        await _app.ClickNoteInListAsync(title);
        await _app.AssertNoteScreenLoadedAsync();
        await Assertions.Expect(
            _page.GetByTestId("note-content").Locator("img")
        ).ToHaveCountAsync(0);
    }
}
