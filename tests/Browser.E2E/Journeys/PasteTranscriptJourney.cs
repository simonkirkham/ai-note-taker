using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// Phase 38-B: open a note, paste a transcript captured in an external tool into it, and see the
// transcript on the note's Transcript tab. Asserts only that the transcript is present (token-gated,
// reload-tolerant) — never the AI output, which is non-deterministic (real Bedrock) and irrelevant
// to this ingestion behaviour.
[Collection("E2E Journeys")]
public sealed class PasteTranscriptJourney(BrowserFixture browser) : IAsyncLifetime
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

    [E2EFact]
    public async Task Paste_a_transcript_into_a_note_and_see_it()
    {
        // A distinctive line so the assertion can't match incidental page text.
        var marker = $"Imported transcript {Guid.NewGuid():N}";

        // Given a new note is open
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();

        // When I paste a transcript into it
        await _app.PasteTranscriptIntoOpenNoteAsync($"{marker}. We agreed Alice will ship the fix on Friday.");

        // Then the note's Transcript tab shows the pasted text
        await _app.AssertImportedTranscriptVisibleAfterReloadAsync(marker);
    }
}
