using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// Phase 51-C: a recording keeps running while you read another note.
//
// WHY THIS EXISTS WHEN VITEST ALREADY COVERS THE SLICE. The vitest specs mock
// `useTranscription` — the very hook whose teardown is the risk — so they prove the ownership
// logic around the session and nothing about the session itself. This journey drives the REAL
// hook: a real getUserMedia, a real AudioContext + worklet, real STS credentials and a real
// Transcribe stream, then changes route and asserts the capture is still live. That is the one
// assertion jsdom structurally cannot make.
//
// THE FAKE MICROPHONE. Chromium's `--use-fake-device-for-media-stream` synthesises a tone, and
// `--use-fake-ui-for-media-stream` auto-accepts the permission prompt. It emits no speech, so
// this journey asserts the SESSION SURVIVES, never that words were transcribed — there are none.
// Speech-to-text quality is not what 51-C changed.
//
// It launches its OWN browser rather than taking the shared fixture's. Launch args are per-browser
// in Playwright, not per-context, so putting fake-media flags on the fixture would hand a fake
// microphone to all seventeen other journeys to buy one. The cost is one extra Chromium per run.
//
// SCREEN-SHARE AUDIO IS TURNED OFF FIRST. The call-audio toggle defaults ON, and
// `getDisplayMedia` needs a picker no headless browser has. The production path catches that and
// falls back to mic-only, so leaving it on would still record — but it would make every run wait
// out a rejection on the way, for a code path this slice does not touch.
[Collection("E2E Journeys")]
public sealed class RecordingTabJourney : IAsyncLifetime
{
    private readonly BrowserFixture _fixture;
    private IPlaywright _playwright = null!;
    private IBrowser _browser = null!;
    private IBrowserContext _context = null!;
    private AppPage _app = null!;
    private IPage _page = null!;

    public RecordingTabJourney(BrowserFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        _playwright = await Playwright.CreateAsync();
        _browser = await _playwright.Chromium.LaunchAsync(new()
        {
            Headless = true,
            Args =
            [
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                // The worklet runs inside an AudioContext created without a user gesture in the
                // eyes of headless Chromium; without this it stays suspended and no audio is ever
                // pulled, so the session never leaves 'requestingCredentials'.
                "--autoplay-policy=no-user-gesture-required",
            ],
        });
        _context = await _browser.NewContextAsync();
        await _context.GrantPermissionsAsync(["microphone"]);
        await _context.Tracing.StartAsync(new() { Screenshots = true, Snapshots = true, Sources = true });
        _page = await _context.NewPageAsync();
        _page.Console += (_, msg) => Console.WriteLine($"[browser {msg.Type}] {msg.Text}");
        _page.PageError += (_, err) => Console.WriteLine($"[browser error] {err}");
        _app = new AppPage(_page, _fixture.FrontendUrl, _fixture.E2EAuthToken);
    }

    public async Task DisposeAsync()
    {
        await _context.Tracing.StopAsync(new() { Path = "trace.zip" });
        await _context.DisposeAsync();
        await _browser.DisposeAsync();
        _playwright.Dispose();
    }

    [E2EFact]
    public async Task RecordingSurvivesASwitchToAnotherNote()
    {
        var recording = $"Rec A {Guid.NewGuid():N}"[..20];
        var other = $"Rec B {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();

        // Two notes, created and gated one at a time (the reload-tolerant helper asserts the
        // LATEST note-write token, so overlapping creates break its precondition).
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(recording);
        await _app.SaveAndReturnAsync();
        await _app.AssertNoteVisibleInListAfterReloadAsync(recording);

        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync(other);
        await _app.SaveAndReturnAsync();
        await _app.AssertNoteVisibleInListAfterReloadAsync(other);

        await _app.CloseAllTabsExceptAsync(other);
        await _app.ClickNoteInListAsync(recording);

        await StartRecordingAsync();

        // Switching away is the whole slice. Nothing may be asked, and the capture must still be
        // running when we land — asserted on the OTHER note's screen, where the tab bar is the
        // only thing that can tell us.
        await _app.ClickOpenNoteTabAsync(other);
        await Assertions.Expect(_page.GetByTestId("leave-confirm-text")).Not.ToBeVisibleAsync();
        await Assertions.Expect(RecordingDotOn(recording)).ToBeVisibleAsync();
        await Assertions.Expect(RecordingDotOn(other)).Not.ToBeVisibleAsync();

        // The single-recorder rule, from the note that does not hold the session.
        await Assertions.Expect(_page.GetByTestId("transcription-record-button")).ToBeDisabledAsync();

        // Back to the recording note: the live timer is only rendered while the session is
        // actually recording, so its presence is the proof the session was never torn down.
        await _app.ClickOpenNoteTabAsync(recording);
        await Assertions.Expect(_page.GetByTestId("transcription-timer")).ToBeVisibleAsync();
        await Assertions.Expect(_page.GetByTestId("transcription-error")).Not.ToBeVisibleAsync();

        // Leave nothing streaming behind: an abandoned Transcribe session bills until it times out.
        await _page.GetByTestId("transcription-stop-button").ClickAsync();
    }

    /// <summary>The recording marker on one note's tab in the open-note bar.</summary>
    private ILocator RecordingDotOn(string title) =>
        _app.OpenNoteTabs.Filter(new LocatorFilterOptions { HasText = title })
            .GetByTestId("open-note-tab-recording");

    /// <summary>
    /// Start a real capture and wait for it to be live. Diagnosis rides in the THROWN message —
    /// a helper that dies inside the driver names neither the state it reached nor why, and this
    /// one has three distinct ways to fail (permission, worklet, credentials) that look identical
    /// from a bare timeout.
    /// </summary>
    private async Task StartRecordingAsync()
    {
        var callAudio = _page.GetByTestId("transcription-call-audio-toggle");
        if (await callAudio.IsCheckedAsync()) await callAudio.UncheckAsync();

        await _page.GetByTestId("transcription-record-button").ClickAsync();

        try
        {
            // Generous: this waits on an STS call, a dynamic import of the Transcribe SDK and the
            // AudioContext coming up, on a cold Lambda.
            await Assertions.Expect(_page.GetByTestId("transcription-timer"))
                .ToBeVisibleAsync(new() { Timeout = 30_000 });
        }
        catch (PlaywrightException)
        {
            var error = await TextOrNoneAsync(_page.GetByTestId("transcription-error"));
            var stillAsking = await _page.GetByTestId("transcription-stop-button").IsVisibleAsync();
            throw new Exception(
                $"The recording never went live. On-screen error: {error}. "
                + $"Stop button showing (so it was still requesting): {stillAsking}. "
                + $"URL: {_page.Url}. "
                + "Most likely one of: the fake microphone was refused, the audio worklet never "
                + "started, or /transcription/credentials failed.");
        }
    }

    private static async Task<string> TextOrNoneAsync(ILocator locator) =>
        await locator.CountAsync() > 0 ? await locator.InnerTextAsync() : "(none shown)";
}
