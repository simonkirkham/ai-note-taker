# Future Features

Possible features that are **not yet committed to a numbered phase**. This is the idea register: things worth doing that haven't been broken down or scheduled. Review it when planning the next phase or looking for the next thin slice.

When a feature here is picked up, Scout breaks it down into a numbered phase (`docs/phases/phase-N.md`) and adds a phase summary to [docs/roadmap.md](roadmap.md). At that point, remove it from this list — the phase doc becomes its home.

This doc is for **features** (new user-facing capability). For the other tracks see:
- **Bugs** → [docs/phases/phase-bugs.md](phases/phase-bugs.md)
- **Minor tweaks & changes** → [docs/phases/phase-minor-changes.md](phases/phase-minor-changes.md)
- **Technical / infra improvements** → [docs/technical-improvements.md](technical-improvements.md)

Each entry records what it is, why it isn't scheduled yet, and where it was raised.

---

## Expand the to-do functionality for today and the future

**What:** Grow the to-do feature beyond today's flat list into something that understands **when** a to-do is due. Today the To Do section (`web/src/components/TodoSection.tsx`, fed by the cross-note todo projection from Phase 3 and the standalone todo aggregate from Phase 11) shows a single undated list of open items plus an expandable Done list. This feature adds a time dimension: to-dos that are scheduled for **today** versus **upcoming/future** dates, so the home screen can show "what's due today" distinctly from "what's coming up", and future-dated to-dos don't clutter today's view until they're relevant. Likely sub-capabilities to scope when broken down:
- A **due date** (and/or scheduled date) on a to-do — a new event on the todo aggregate (e.g. `ActionItemDueDateSet` / `TodoScheduled`), kept purely additive so existing events are untouched.
- Home views/grouping: **Today**, **Upcoming**, and possibly **Overdue**; reuse the local-date discipline from CHANGE-3 (compute "today" as the local calendar date, compare `YYYY-MM-DD` strings, beware timezone/time-bomb pitfalls).
- A projection (or extension of the existing todo projection) that exposes the due date and supports the today/future grouping.
- UI to set/clear a due date on both note-derived action items and standalone home-quick-capture to-dos.

**Why it isn't scheduled yet:** Needs breaking down — the event-model additions (new event(s), projection changes) and the UX (grouping, where future to-dos surface, overdue handling) should be designed by Scout into a numbered phase before implementation. It's a genuinely new capability, not a tweak to the existing flat list.

**Raised in:** User request, 2026-06-02 — "we need to expand the to-do functionality for today and future."

---

## Scalable note loading (pagination) + server-side folder tag search

**What:** Today the entire note set is loaded into the client (`cards` in `App.tsx`), and all filtering — date, tags, folder — happens in the browser over that full set. This won't hold once a user has too many notes. This feature moves note loading to a **paginated / lazy** model (server returns a page at a time) and, as a direct consequence, moves filtering to the **server** so a filter searches *all* matching notes, not just the page that happens to be loaded. Scope to design when broken down:
- **Paginated notes endpoint(s)** — page/cursor-based listing for home and folder views; the frontend loads more on demand (scroll / "load more").
- **Server-side filtering** — date and tag filters become query parameters resolved against projections, so results are complete regardless of what's loaded.
- **Server-side folder tag search** *(this absorbs the former minor-change CHANGE-12)* — when viewing a folder, the tag filter must offer the tags used across **all** notes in that folder (just that folder, **not** the subtree — confirmed 2026-06-02), and filtering by a tag must match all of the folder's notes, not only the loaded page. Both require a server source: a folder→tags aggregation (e.g. a projection keyed by folder id, reacting to `NoteCreated` / tag add / tag remove / folder move / note delete; surfaced as something like `GET /folders/{id}/tags`) and a server-side tag-filtered note query. This is why folder-scoped tag search was pulled out of the minor-changes track — it can't be made correct before pagination exists (until then everything is loaded and the trivial client-side version already works), and the two are best built together.

**Why it isn't scheduled yet:** Needs breaking down by Scout into a numbered phase. It's a substantial change — new query/pagination endpoints, projections for server-side tag aggregation, frontend incremental loading, and reworking the home/folder filter pipeline from client-side to server-side. Strong event-sourcing learning surface (query models, pagination over projections, keeping optimistic UI correct against partial data).

**Decided so far (2026-06-02):** folder tag search is scoped to *just that folder, not its subtree*; the folder note list stays direct-children-only as it is today.

**Raised in:** Routing discussion for the folder-scoped tag filter, 2026-06-02 — the user noted that in future not all notes will be loaded, but still wants to search across **all** notes in a folder, which forces server-side aggregation/filtering. Related: [[#dynamic-folders-saved-tag-based-views]].

---

## Dynamic folders (saved tag-based views)

**What:** "Folders" that aren't a place notes live but a **saved query over tags** — e.g. a dynamic folder "Urgent Work" defined as `work AND urgent` that always shows every note matching those tags, with no manual filing. They'd appear in the sidebar alongside real (structural) folders and be navigable the same way, but their contents are computed from the tag index rather than from a `folderId`. Likely considerations when broken down: how dynamic folders are created/edited (pick tags + AND/OR), how they're visually distinguished from structural folders, whether a note can be "in" both a real folder and any number of dynamic ones (it can — membership is derived), and how they interact with the tag filter and with reparenting/drag-and-drop (a note can't be *moved into* a dynamic folder; filing is implicit via its tags).

**Why it isn't scheduled yet:** Early idea — needs more thought. It builds directly on the existing `TagIndex` projection (Phase 5) and the AND/OR tag filter, and pairs naturally with **server-side tag filtering** from the scalable-note-loading feature above — a dynamic folder is essentially a persisted, named tag query, so it wants the same server-side filtering to be correct at scale. Best designed after (or with) that work.

**Raised in:** User idea, 2026-06-02, raised while discussing folder-scoped tag search. Related: [[#scalable-note-loading-pagination-server-side-folder-tag-search]].

---

## Desktop app to remove per-meeting audio-share consent

> _Graduated to a numbered phase — now **[Phase 31](phases/phase-31.md)** (2026-06-22). Locked: Windows-only, bundle-shell, unsigned `electron-builder` build. Feasibility de-risked by the 2026-06-03 Windows spike; full scope, slices, and spike reference live in the phase doc._

---

## Desktop app auto-update (Chrome-style)

**What:** Make the installed desktop app update itself instead of requiring a manual `npm run package` + reinstall. Phase 31 shipped the installer with **no auto-update** by design (a single-user personal build). This adds the standard Electron update path: publish each release to a feed (GitHub Releases / S3 — `electron-builder` already generates the `latest.yml` manifest + `.blockmap` delta), have the app `autoUpdater.checkForUpdates()` on launch, download in the background, and `quitAndInstall()` on next restart (install-alongside, swap-on-restart — you cannot overwrite a running binary). Reuses `electron-updater`, which ships with the `electron-builder` already in `desktop/`. Note this only matters for **frontend/desktop-shell** changes — backend/API changes already reach the app live via the `/api` proxy with no rebuild.

**Why it isn't scheduled yet:** Not worth it for a single user who has the repo and can `npm run package`. Auto-update's machinery exists to distribute to **many untrusted machines**, which doesn't apply today. The real cost is **code signing** — on Windows an unsigned auto-update triggers SmartScreen friction (or you disable electron-updater's signature check and lose the security property); on macOS an Apple Developer cert is effectively mandatory. Schedule this only if the app is ever shared beyond the author. When picked up it's a self-contained slice: publish feed → check-on-launch → relaunch-to-apply (+ a signing decision).

**Raised in:** User question, 2026-06-23 — "how do other apps like Chrome handle updates?" — after Phase 31 shipped the manual-reinstall installer.

_(Per-workspace calendars graduated to **[Phase 34](phases/phase-34.md)** on 2026-06-23 — it absorbs TI-47 as its in-app-OAuth foundation.)_

---

_(Claude Cowork connector — read-only, workspace-scoped MCP server — graduated to **[Phase 35](phases/phase-35.md)** on 2026-06-24. Locked: read-only first, per-workspace connector URL `/w/{wsId}/mcp`, OAuth reusing the Google identity, no new events. Full scope and slices live in the phase doc.)_

---

## In-app microphone selector

**What:** Let the user choose which input device the recorder uses, instead of silently taking the OS/browser default. Today `useTranscription.startRecording` calls `navigator.mediaDevices.getUserMedia({ audio: true })` (`web/src/hooks/useTranscription.ts:314`) with no `deviceId` constraint and no UI — so whichever device is the system default at record time is captured, with no visibility or override. Scope when broken down:
- Enumerate inputs (`navigator.mediaDevices.enumerateDevices()`, audioinput kind) and offer a picker near the Record control; pass the chosen `deviceId` as a `getUserMedia` constraint.
- Persist the last choice (localStorage) so it survives reloads; fall back to default if the device is gone.
- A small live input-level meter would help the user confirm the right mic is hot before recording (optional sub-slice).

**Why it isn't scheduled yet:** Frontend-only capability that needs a small UX design (where the picker lives, level meter or not) and device-permission/edge-case handling (device removed mid-session, permission prompts). Not a tweak to existing behaviour — it's a new control surface.

**Raised in:** User question, 2026-06-24 — "how will it determine which mic to select?" — after a back-filled diarization surfaced a poor-quality recording (mic was the OS default; remote participants captured acoustically through speakers).

---

## Meeting-capture audio quality mode (raw mic + steer to clean call audio)

**What:** A capture mode tuned for recording **meetings**, not headset voice calls. Two problems combine to garble recordings today: (1) `getUserMedia({ audio: true })` applies Chrome's defaults — echo cancellation, noise suppression, auto-gain are all **on** — and AEC actively suppresses remote participants whose audio is played through the speakers (it treats them as "echo"); (2) when "include call audio" is off, the far end exists only as distant acoustic bleed in the mic. Scope when broken down:
- A constraint preset that disables the voice-call DSP for meeting capture (`echoCancellation: false, noiseSuppression: false, autoGainControl: false`) — A/B against the defaults on a real recording before defaulting it on.
- Make the clean path discoverable: surface/strongly recommend **"include call audio"** (the existing `getDisplayMedia({ audio: true })` system-audio mix, `useTranscription.ts:296`) when a call is being recorded, so remote voices come in digitally rather than through the room. Possibly default it on, with a clear "share system/tab audio" prompt.
- Optional: detect likely-poor capture (very low input level / heavy AGC) and warn before/after recording.

**Why it isn't scheduled yet:** Needs empirical tuning (the DSP-off preset can help *or* hurt depending on room/mic, so it must be measured, not assumed) plus a UX decision on defaults. Distinct from the mic-selector feature: that picks the *device*; this changes how the chosen device's stream is *captured and mixed*. Ties into the Phase 33 diarization quality goal — diarization can only be as good as the captured audio.

**Raised in:** User observation, 2026-06-24 — "on the second one the audio quality seems really poor" — single-mic capture of a speaker-played call, the diarization spike's known hardest input.

---

## Add a transcript manually from an external tool

> _Graduated to a numbered phase — now **[Phase 38](phases/phase-38.md)** (2026-06-25). Locked: reuse the recorded-note events minus audio (`NoteCreated` → `TranscriptionCompleted` → analysis), **no new event/command**; a single server-side `POST /w/{ws}/notes/import-transcript` that analyses via `transcriptOverride` to sidestep the RYW async-projection race; plain text only (title/date/attendees deferred). Full scope and slice live in the phase doc._

---

## Drag-and-drop to reorder to-do / action items

> _Graduated to a numbered phase — now **[Phase 37](phases/phase-37.md)** (Done, 2026-06-25). Scoped to the **home To Do list only** (per-note action ordering deferred). Shipped: a per-workspace ordering stream (`todo-order#<workspaceId>` + `TodoOrdering` aggregate) emitting a full-order-snapshot `TodoListReordered` event — item aggregates untouched; projection folds it into a nullable `Position` on `TodoItem` (sort `Position ?? max`, then `AddedAt`); optimistic + RYW via the order-stream token; native drag (no DnD library) + keyboard Move up/down. Per-note action reordering remains a future option if wanted._

---

## Redefine note "topics" as a concept separate from headings

> _Graduated to a numbered phase — now **[Phase 43](phases/phase-43.md)** (2026-06-29). Resolved via the `prototype/topics-explore` exploration (final: `v7-agenda-in-header.html`): the answer is a separate **meeting agenda** in the note header (its own data, not encoded in markdown), 2-state items, no side space — not an inline marker on headings. The body stays free-form; the legacy heading-✓ is retired in 43-E. Full scope and slices live in the phase doc._

---

## Connect to external transcript tools (Zoom, Teams, etc.)

**What:** Import meeting transcripts automatically from third-party meeting tools (Zoom first; Teams, Google Meet, etc. later) instead of recording in-app or pasting by hand. The connector pulls a finished meeting's transcript from the provider and creates a note that runs through the same analysis pipeline. Scope when broken down:
- Per-provider OAuth/connection (Zoom's cloud-recording + transcript API first), likely reusing the in-app OAuth foundation from Phase 34 and the per-workspace connection model.
- Fetch the transcript (and meeting metadata — title, time, attendees) for a completed meeting and create a transcript-only note from it (shares the **manual transcript import** ingestion path above).
- Decide pull model: on-demand "import from Zoom" picker vs. webhook/poll for new recordings; attendee → tag/diarization-name mapping is a later enhancement.

**Why it isn't scheduled yet:** Substantial — per-provider API integration, OAuth scopes, and a sync/poll model, all of which want the manual-transcript ingestion path to exist first. Best sequenced **after** "Add a transcript manually" (which de-risks the analyse-an-imported-transcript flow) and after the in-app OAuth work it can reuse. Related: [[#add-a-transcript-manually-from-an-external-tool]].

**Raised in:** User feature idea, 2026-06-25.
