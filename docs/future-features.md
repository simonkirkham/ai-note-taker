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

**What:** Package the existing `web/` React app inside a desktop shell (Electron, or Tauri) so capturing call/system audio no longer requires the browser's per-meeting screen-share dialog. Today transcription captures two streams in `web/src/hooks/useTranscription.ts`: the mic via `getUserMedia({audio:true})` (whose permission can be made sticky) and call/system audio via `getDisplayMedia({audio:true, video:true})`. The second call is the friction: the W3C Screen Capture spec **mandates** a fresh user gesture + source picker on every invocation and forbids persistent screen-share permission, so for a *web origin* this nag is irreducible — no flag, origin policy, or PWA "install" changes it (a PWA is the same origin under the same rules, so it buys nothing here). A desktop shell ships its own Chromium, so it controls permission handling: Electron's `session.setDisplayMediaRequestHandler` can **auto-grant** display capture and programmatically select the source + loopback audio with no picker and no per-meeting consent — just a one-time OS-level grant per machine (trivial on Windows; a one-time "Screen Recording" toggle on macOS). Scope when broken down:
- **Electron shell + main process** wrapping the built frontend; `setDisplayMediaRequestHandler` to auto-select source + audio.
- **Minimal hook change:** in the desktop build, swap the `getDisplayMedia` picker call for the auto-granted stream; the mic+system mixing logic (from `useTranscription.ts:129` onward) and the AWS Transcribe streaming path are untouched.
- **Zero backend / CDK changes** — transcription credentials still come from the existing API endpoint and the PCM worklet is reused as-is.
- **Packaging** via `electron-builder`; code signing / auto-update optional (skippable for personal/learning use).
- **Highest-fidelity alternative** (more work, likely overkill): skip `getDisplayMedia` entirely and capture the OS audio loopback natively (WASAPI loopback on Windows), giving zero consent and best audio quality but platform-specific native code.

**Why it isn't scheduled yet:** Needs breaking down by Scout into a numbered phase. Mostly reuse — the React app, transcription path, and API stay as-is — but it introduces a new build/packaging target, an Electron main process, and the auto-grant permission wiring; the macOS audio-capture path is materially harder than Windows and may be deferred or skipped. Estimate is roughly a weekend-to-a-week for a single-platform (Windows) unsigned personal build. Good learning surface (desktop shell + native permission model) and aligned with the project's "optimise for learning surface area" goal.

**Spike result (2026-06-03, Windows — de-risked):** A throwaway Electron spike on the `prototype/desktop-audio-spike` branch (`desktop-spike/`) confirmed the core hypothesis. With `session.setDisplayMediaRequestHandler` answering each request `{ video: <screen>, audio: 'loopback' }`, the renderer's `getDisplayMedia({audio,video})` resolved with **no source-picker dialog and no per-meeting consent**, and a live level meter tracked **system audio** (Windows loopback). So the picker friction is genuinely removable via a desktop shell — the remaining work is integration/packaging, not feasibility. macOS loopback via this handler remains unproven (the known weak platform). Branch is reference-only, never merged.

**Raised in:** User request, 2026-06-03 — "Currently agreeing to share the audio from the machine for each meeting is far from ideal"; would an installed app make audio access easier?

> _Graduated to a numbered phase — "Notes-as-prompt: inline AI instructions" is now [Phase 29](phases/phase-29.md)._
