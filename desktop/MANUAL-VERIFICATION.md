# Desktop manual verification (Windows)

The automated `npm run test:e2e` proves the shell launches and renders the bundled
frontend. The items below need **real Google OAuth + a real Windows machine** and
cannot run in CI — verify by hand on Windows before marking a slice Done.

## 31-A — shell + in-window sign-in

**One-time setup (external):**
1. In Google Cloud Console → the existing OAuth **Web** client, add `http://localhost:5180` to **Authorized JavaScript origins** *and* **Authorized redirect URIs** (the app serves itself on `http://localhost:5180`; `redirect_uri = window.location.origin`).
2. Build with the client id baked in: `VITE_GOOGLE_CLIENT_ID=<id> npm run build`, then `npm start`.

**Verified 2026-06-22 on Windows** (build SHA `c44a6e3`, client `175601380067-sck0…`).

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | Given a first launch, When I click **Sign in with Google**, Then the Google consent/sign-in completes **inside the app window** (no external browser hand-off) and my notes list loads from the **prod API**. | ✅ 2026-06-22 |
| 2 | Given I am signed in, When I **quit and relaunch** the app, Then I am still signed in — no re-consent (the `rt` refresh-token cookie persisted in the Electron session). | ✅ 2026-06-22 |
| 2a | **Cookie mechanism (load-bearing):** after sign-in, confirm the `rt` cookie is actually **stored and replayed** — the `Secure` cookie must survive on `http://localhost`. If sign-in works but step 2 fails, this is the cause (DevTools → Application → Cookies → `http://localhost:5180`). | ✅ proven by #2 |
| 2b | **Sign-in redirects stay on localhost:** during sign-in, if the window ever lands on `https://note-taker-ai.com/...` instead of returning to `http://localhost:5180`, an `/api` redirect wasn't rewritten — note the URL. | ✅ stayed on localhost |
| 3 | Given the app is running, When I check the loaded notes, Then they are my real prod notes (confirms the bundle calls the live prod API, not a stub). | ✅ 2026-06-22 |
| 4 | Given CloudFront is unreachable (e.g. block its host), When I launch, Then the shell **still renders** (assets are local) — only live API calls fail. | ☐ not yet tested |

Record the build SHA shown on launch (31-A AC: stamp the bundled commit) next to the result.

## 31-B — deterministic system-audio grant

`pickDisplayMediaResponse` (primary-screen selection + `audio:'loopback'`) is unit-tested headlessly in `tests/displayMedia.spec.ts`. The grant only *fires* against a real display + audio stack on Windows, so verify by hand. **Re-run #1–#2 after any `electron` upgrade** — that is the whole point of 31-B (the implicit Electron default could regress; the explicit handler should not).

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Silent-mic system-audio:** Given another app is playing audio (a video/call) and I do **not** speak, When I record ~15 s, Then the transcript reflects the **system** audio (not empty). | ✅ 2026-06-22 |
| 2 | **No picker, no consent:** Given I click record, Then capture starts immediately — **no** screen-source picker dialog and **no** per-meeting consent prompt. | ✅ 2026-06-22 |
| 3 | **Deterministic-grant log:** Given the app console (terminal running `npm start`), When I record, Then it logs `[desktop] display-media granted: screen <id> (matched primary) + loopback audio` — proving the *explicit* handler fired, not the Electron default. | ✅ 2026-06-23 (`screen screen:0:0 (matched primary)`) |
| 4 | **Mic+system mix unchanged:** Given I both speak and play system audio, When I record, Then both are transcribed (mix path identical to the web app). | ✅ 2026-06-23 |

## 31-C — packaged Windows installer

The electron-builder config is asserted headlessly in `tests/packaging.spec.ts`. Producing
the `.exe` needs Windows (`electron-builder --win` uses Wine on Linux), so build + install by hand.

```powershell
npm install ; npm --prefix ../web install   # one-time
npm run package                              # → release/AINoteTaker-Setup-<version>.exe
```

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Installer is produced:** Given `npm run package` on Windows, Then `release/AINoteTaker-Setup-<version>.exe` is created (no signing). | ☐ |
| 2 | **Clean install launches:** Given a machine without the app, When I run the `.exe`, Then it installs (one-click, no admin), adds a Start-menu/desktop shortcut, and the window opens rendering the **bundled** frontend. | ☐ |
| 3 | **Sign-in works post-install:** Given the installed app (no env var, no dev server), When I sign in with Google, Then it completes in-window and my prod notes load (client id baked into the bundle). | ☐ |
| 4 | **Records with one-time OS grant:** Given the installed app, When I record, Then system + mic audio are captured with no per-meeting picker/consent (one-time OS grant only). | ☐ |
| 5 | **Relaunch from Start menu:** Given I closed the app, When I launch it from the Start-menu shortcut, Then it opens and I am still signed in (no rebuild, no terminal). | ☐ |

> **Note:** no app icon is set, so the installer/app/shortcut use electron-builder's default Electron icon (a warning at build time, not an error). Add an `icon` to `electron-builder.json` later if a branded icon is wanted.

## 31-D — CI-published installer + `npm run update`

CI builds the installer on a Windows runner and publishes it to the rolling `desktop-latest` GitHub Release after a successful prod deploy that changed the frontend/desktop ([`publish-desktop.yml`](../.github/workflows/publish-desktop.yml)). Updating is then `npm run update` (pull + install). Wiring is asserted in `tests/publish.spec.ts`; the end-to-end run is verified by hand.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **CI publishes on a frontend deploy:** Given a frontend/desktop change deploys to prod, When `publish-desktop.yml` runs, Then the `desktop-latest` Release exists with an `AINoteTaker-Setup-*.exe` asset tagged to that commit. | ☐ |
| 2 | **Backend/docs deploy doesn't republish:** Given a backend-only or docs-only deploy, Then the publish workflow skips the build (the changed-paths gate is `false`), leaving the existing installer. | ☐ |
| 3 | **`npm run update` installs the published build:** Given `gh` is signed in, When I run `npm run update`, Then it downloads `desktop-latest`, closes the running app, silently installs, and relaunches — no local build. | ☐ |
| 4 | **Manual trigger works:** Given I run the workflow via `workflow_dispatch`, Then it builds + publishes regardless of the last deploy. | ☐ |
| 5 | **Update skips when current (31-E):** Given I just updated, When I run `npm run update` again, Then it prints "already up to date" and exits without downloading the installer; after a new published build it downloads + installs. | ☐ |

## 48-A — live local (on-device) transcription

The desktop app can transcribe locally via a bundled `whisper-cli.exe` (fetched into `resources/whisper/` at package time by `scripts/fetch-whisper-bin.mjs`) driving `base.en`, which downloads in the background on first launch. Pure logic (parser, PCM windowing, engine-choice, model manifest) is unit-tested headlessly; the real capture + latency is verified here. Set **Transcription → On device** in the sidebar footer.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Binary bundled:** Given a packaged install, Then `resources/whisper/whisper-cli.exe` + its `*.dll` are present next to the app. | ☐ |
| 2 | **Model downloads on first launch:** Given a fresh install with the setting on, When I first open the app, Then the toggle shows "Preparing… downloading models" and later flips to ready (model cached under `%APPDATA%/AI Note Taker/models/ggml-base.en.bin`). | ☐ |
| 3 | **Live transcript is produced on-device:** Given the model is ready and Transcription = On device, When I record and speak, Then a live transcript appears and **no** `/transcription/credentials` request is made (check DevTools Network — cloud STT is not used). | ☐ |
| 4 | **Live keeps pace (step 2):** Given a several-minute meeting, When I record locally, Then the live transcript keeps up with speech without unbounded growing lag on this machine. | ☐ |
| 5 | **Saved transcript is complete:** Given I stop, Then the last few seconds appear (the tail window flushed) and the note saves + analyses as normal. | ☐ |
| 6 | **Not-ready falls back to cloud:** Given the model is still downloading, When I record, Then recording uses cloud Transcribe (the setting shows "Preparing…"). | ☐ |
| 7 | **Cloud unchanged:** Given Transcription = Cloud, When I record, Then behaviour is identical to before (no regression). | ☐ |

## 48-B — higher-quality final pass on stop

With local transcription on, the live transcript uses the fast `base.en`; on stop the app re-transcribes the whole recording once with `medium.en` (1.5 GB, downloaded in the background after `base.en`) and saves that higher-quality text. Best-effort: if `medium.en` hasn't finished downloading, the live text is kept.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Final model downloads after live:** Given local mode selected, Then `base.en` lands first (recording becomes available) and `medium.en` continues downloading in the background (`%APPDATA%/…/models/ggml-medium.en.bin`, ~1.5 GB). | ☐ |
| 2 | **Final pass upgrades the transcript:** Given `medium.en` is present, When I record locally and stop, Then a brief "Finalising transcript…" shows and the saved note settles on the higher-quality text (proper nouns/terms more accurate than the live view). | ☐ |
| 3 | **Final pass keeps up:** Given a recording of length N, When the final pass runs, Then it finishes in less than N and the note is not stuck "Finalising". | ☐ |
| 4 | **Graceful degrade:** Given `medium.en` has not finished downloading, When I stop a local recording, Then the live `base.en` text is committed (no error, no indefinite wait). | ☐ |

## 48-C — 1:1 who-said-what (source separation)

For a 1:1 call in local mode, the mic ("Me") and system audio ("Them") are captured separately, transcribed on-device with VAD, and interleaved into a `Me:`/`Them:` transcript — replacing the cloud diarization. Structurally exactly 2 speakers (two physical channels). Needs the `silero-vad` model (865 KB, downloads after `base.en`).

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Exactly Me/Them for a 1:1:** Given local mode + a 1:1 call (system audio captured), When I stop, Then the saved transcript is labelled `Me:` / `Them:` with **exactly two** speakers — never a spurious third (the cloud-diarization symptom this fixes). | ☐ |
| 2 | **No cloud diarization request:** Given local mode, When I stop, Then no `…/transcription/diarize` call is made (DevTools Network) — diarization is on-device; the note is **not** re-refined by the server. | ☐ |
| 3 | **Attribution is reasonable:** Given a natural back-and-forth, Then turns are attributed to the right side (mic vs. system), with errors only on short overlaps. | ☐ |
| 4 | **Quiet side isn't fabricated:** Given long stretches where only one person talks, Then the silent side contributes no invented/looped text (VAD working). | ☐ |
| 5 | **Graceful fallback:** Given the VAD model hasn't downloaded, When I stop a 1:1 local recording, Then it falls back to the single-stream transcript (no error, no cloud diarize). | ☐ |
| 6 | **Mic-only unaffected:** Given local mode with **no** call audio, When I record + stop, Then the single-stream local transcript is saved (no diarization needed) and no cloud diarize runs. | ☐ |

## 48-E — keep recordings on this device only

A desktop setting (sidebar footer, default **on** — privacy-first). With it on, a locally-transcribed meeting uploads **no** audio to S3 — only the transcript is stored. Off = uploads as before. Only affects local-mode recordings; cloud transcription still uploads (ignores the setting).

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Audio stays on-device:** Given the setting is on and Transcription = On device, When I record + stop, Then **no** `…/recording/presign-upload` request is made (DevTools Network) and the note still has its transcript + analysis. | ☐ |
| 2 | **No download affordance:** Given a kept-local recording, Then the note shows no "Download recording" link (nothing was uploaded). | ☐ |
| 3 | **Opt back into upload:** Given the setting is off, When I record locally + stop, Then the audio uploads as before and the recording is downloadable. | ☐ |
| 4 | **Cloud unaffected:** Given Transcription = Cloud, When I record, Then the WAV uploads regardless of this setting (cloud needs it). | ☐ |

## BUG-52 — whisper process lifecycle + resource (Step 1 hardening)

Local transcription must never leave a whisper process running or peg the whole machine. (Live-latency is Step 2 — not covered here.)

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **No orphan on quit:** Given a local recording is finalising, When I close the app, Then no `whisper-cli.exe` remains in Task Manager (was: it kept running at ~50% CPU). | ☐ |
| 2 | **No orphan on stop / new recording:** Given I stop and immediately start a new local recording, Then the previous pass's whisper is killed — CPU doesn't stack. | ☐ |
| 3 | **Machine stays usable:** Given a local final pass runs, Then whisper uses ~half the cores (not all) and the app/OS stay responsive. | ☐ |
| 4 | **Lighter final pass:** Given `small.en` is the final model, Then the on-stop pass is meaningfully faster/lighter than the old `medium.en` (and `medium.en` is no longer downloaded). | ☐ |

## BUG-53 — low-latency live streaming (Step 2, resident whisper-server)

The live transcript must appear within a few seconds and keep pace, on the resident server (model loaded once), not the old spawn-per-window path (5-7 s + churn).

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Live latency:** Given a local recording, When I speak, Then the live transcript appears within ~3-4 s and keeps pace (no growing backlog). | ☐ |
| 2 | **One resident process:** Given a local recording is running, Then Task Manager shows a single `whisper-server.exe` (not a new `whisper-cli.exe` per window), and its CPU is bounded (~half the cores). | ☐ |
| 3 | **Model loads once:** Given I stop and start several local recordings, Then the server stays resident between them (no multi-second model-load stall at the start of the 2nd+ recording). | ☐ |
| 4 | **Server dies on quit:** Given a local recording, When I close the app, Then no `whisper-server.exe` remains in Task Manager. | ☐ |
| 5 | **Final pass still runs:** Given I stop a local recording, Then the higher-quality `small.en` final pass still replaces the live text (transcript quality improves on stop). | ☐ |
| 6 | **Missing binary/model falls back cleanly:** Given the whisper binary/model is missing, When I start a local recording, Then it falls back to cloud before recording (no mid-recording failure). | ☐ |
| 7 | **Present-but-unstartable server surfaces a banner:** Given the binary/model exist but the server fails to start (e.g. port/OOM/timeout), When I record locally, Then the on-device-failed banner appears (live view is not silently empty) and the audio is still captured for the stop-time final pass. | ☐ |

## BUG-56 — the live path actually runs, and never fails silently

BUG-53's checklist above was never completed, and the live path shipped dead: `WhisperServer` was spawned with `whisper-cli.exe`, which exits on `--host`. **Row 2 below is the one that would have caught it.** Run against a freshly-installed build, not `npm run dev`.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **The server binary ships:** Given the installed app, Then `%LOCALAPPDATA%\Programs\ai-note-taker-desktop\resources\whisper\` contains **both** `whisper-cli.exe` and `whisper-server.exe`. | ☐ |
| 2 | **The server actually runs:** Given a local recording, Then Task Manager shows a live `whisper-server.exe` **while recording** — absent before the fix, so this is the regression signal. | ☐ |
| 3 | **Live text appears:** Given a local recording, When I speak, Then text appears in the transcript within ~3-4 s, during the recording — not only after Stop. | ☐ |
| 4 | **Failure is visible, not silent:** Given the local engine cannot start (rename `whisper-server.exe` to force it), When I record locally, Then the on-device-failed banner appears **while the recording is still running**, and the stop-time pass still produces a transcript. | ☐ |
| 5 | **No stale banner:** Given a recording that showed the banner, When I start a new local recording that works, Then the banner is gone. | ☐ |
| 6 | **Stop is unchanged:** Given I stop a local recording, Then the `small.en` final pass still replaces the live text (slower than live — expected cost, not a defect). | ☐ |

## BUG-65 — live transcription speed, and the diagnostic log

The whole point of this slice is the log: an installed build is otherwise unobservable (whisper-server's stdout is not captured, the console needs DevTools), which is why BUG-56 and BUG-65 both had to be diagnosed by reading code instead of evidence.

**The log lives at `%APPDATA%\AI Note Taker\local-transcription.log`** (one rotation, `.log.1`, capped at 512 KB). It contains counts and timings only — no transcript text, no file paths beyond the model's basename.

**`rtf` is the column that matters:** inference time ÷ audio duration. Below 1.0 the engine is faster than real time and the live view can keep pace; above 1.0 it is falling behind by definition.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Live text keeps pace:** Given a local recording, When I speak continuously for ~30 s, Then words appear within a few seconds and do not fall further behind as the recording goes on. | ☐ |
| 2 | **The log exists and is readable:** Given a finished local recording, Then `local-transcription.log` holds a `session start` line followed by `step` lines. | ☐ |
| 3 | **rtf is below 1.0:** Given the step lines, Then `rtf` is consistently < 1.0. If it is not, the tuning is insufficient and threads are the next lever — send the log. | ☐ |
| 4 | **Not falling behind:** Given the step lines, Then `dropped` stays low and `clamped` is absent or rare. A rising `dropped` means inference is slower than the 1.5 s tick; any `clamped` means the window hit the encoder send cap. | ☐ |
| 5 | **Failures are visible:** Given the engine fails (rename `whisper-server.exe`), Then the log records `step FAILED … err=…` rather than going silent. | ☐ |
| 6 | **The saved transcript is unaffected:** Given I stop, Then the note's transcript is the higher-quality `small.en` pass, not the live text — the live view's reduced accuracy must not reach the note. | ☐ |

## BUG-67 — the live engine stops when the audio does

Closable only from the log, like [BUG-65]: the symptom is CPU burn, not anything on screen.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **No spin after Stop:** Given a local recording, When I press Stop, Then `local-transcription.log` shows **no further `step` lines** with `window` and `committed` both unchanged. Before the fix there were ~12 such lines over 30 s. | ☐ |
| 2 | **The wait after Stop is shorter:** Given a recording of the same length as before, Then the "Finalising transcript…" wait is shorter than it was on build `182` — the spin was competing with that pass for cores. | ☐ |
| 3 | **Live text still works:** Given I speak, pause for ~10 s, then speak again, Then the transcript keeps updating after the pause — the guard detects idleness, it must not latch off. | ☐ |
| 4 | **The saved transcript is unaffected:** Given I stop, Then the note holds the full `small.en` transcript including the final words spoken. | ☐ |

## CHANGE-36 — window title follows the open note

`BrowserWindow` is constructed with no `title` option, so the Electron window (and its taskbar label) follows `document.title`. Making the browser tab title track the note therefore changes the desktop window title too — intended, but verify it reads sensibly.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **App title on the home screen:** Given the app is open on the notes list, Then the window/taskbar title reads `Note Taker AI` (not the old `Note Taker`). | ☐ |
| 2 | **Note title while a note is open:** Given I open a note called "Roadmap review", Then the window/taskbar title reads `Roadmap review - Note Taker AI`. | ☐ |
| 3 | **Reverts on leaving:** Given a note is open, When I go back to the list, Then the window title returns to `Note Taker AI` (the note name is not stranded). | ☐ |
| 4 | **Untitled note:** Given I open a note with no title, Then the window title reads `Note Taker AI` with no trailing separator. | ☐ |

## CHANGE-37 — right-click spelling corrections

Electron's spellchecker was already underlining misspellings, but Electron ships no default context menu, so there was no way to act on one. The menu only appears for a misspelled word in an editable field.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Squiggles still there:** Given a note, When I type `teh recieve`, Then both words are underlined. | ☐ |
| 2 | **Suggestions offered:** Given a misspelled word, When I right-click it, Then a menu lists spelling suggestions. | ☐ |
| 3 | **Replacement works:** Given that menu, When I click a suggestion, Then it replaces the word in place and the note still saves correctly. | ☐ |
| 4 | **Add to dictionary:** Given a proper noun the checker flags (e.g. a client name), When I right-click and choose "Add to dictionary", Then the squiggle goes and it stays un-flagged after an app restart. | ☐ |
| 5 | **No menu on correct text:** Given a correctly-spelled word, When I right-click it, Then no menu appears (unchanged from today). | ☐ |
| 6 | **No menu outside an editor:** Given the notes list or a heading, When I right-click, Then no menu appears. | ☐ |

## CHANGE-32 — pinned microphone grant

The app now answers Electron's permission requests itself instead of riding the implicit-grant default. It is an allow-list: only the `http://localhost:5180` bundle origin, and only `media` / `display-capture` / `notifications`. Behaviour should be **identical** to before — this verifies nothing was tightened by accident. Every decision is logged (`[desktop] permission request media: granted — …`), so the console is the evidence. Unaffected: the Windows OS-level microphone privacy setting, which still gates everything below.

| # | Given / When / Then | Pass? |
|---|---------------------|-------|
| 1 | **Mic still opens:** Given the app is open, When I start a recording, Then it records and the transcript appears — no permission error (the mic stream has no fallback, so a denial would kill recording outright). | ☐ |
| 2 | **Grant is logged:** Given a recording just started, When I check the console (`npm run app`), Then a line reads `[desktop] permission request media: granted — media granted to the bundle origin`. | ☐ |
| 3 | **System audio still captured (31-B not regressed):** Given a meeting is playing through the speakers, When I record, Then the other party's speech still lands in the transcript. | ☐ |
| 4 | **Meeting reminders still fire:** Given a meeting is due, Then the desktop notification still appears (`notifications` is on the allow-list; leaving it off would have broken this). | ☐ |
| 5 | **Nothing unexpected is being denied:** Given I use the app normally (open notes, edit, record, sign in via Google), Then no `[desktop] permission … denied` warning appears in the console for a feature that used to work. | ☐ |
| 6 | **OS gate unchanged:** Given Windows microphone access is turned off for desktop apps, When I record, Then it fails at the OS level exactly as before (this pin does not bypass it). | ☐ |
| 7 | **The CHECK handler grants, not just the request handler:** Given the app has been open a moment, When I check the console, Then a line reads `[desktop] permission check media: granted — …` and **no** `permission check … denied` line names `media` or `notifications`. | ☐ |

> **Why row 7 exists.** The unit specs assert against the shapes we *believe* Electron passes; they cannot prove the wire format. Review caught the first implementation comparing the check handler's origin raw — Electron hands it a GURL serialised with a **trailing slash** (`http://localhost:5180/`), which never matched the bundle origin, so **every check was denied while all 17 specs passed**. Symptoms if it regresses: meeting reminders fall back to a plain `alert()`, microphone device names show blank in any picker, and Chromium's pre-flight can fail `getUserMedia` before the request handler is ever consulted. Row 7 is the only check that would catch it.

## Troubleshooting

- **`Error 400: redirect_uri_mismatch` immediately after adding `http://localhost:5180`** — the value is correct (`redirect_uri = window.location.origin = http://localhost:5180`: no trailing slash, `localhost` not `127.0.0.1`, port `5180`, `http` not `https`). The cause is **Google propagation lag** — a freshly added+saved redirect URI is not live immediately; it can take **~5 min to a few hours**. Confirm the running app's `window.location.origin` (DevTools console) reads exactly `http://localhost:5180`, then wait and retry. **No code change.** Hit and confirmed 2026-06-22: config was right on the first attempt; the URI simply had not propagated.
