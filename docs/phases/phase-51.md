# Phase 51 — Tabs redesign _(Not Started)_

**Goal:** the tabs on a note screen tell you at a glance what each note actually holds and which one is recording, instead of showing the same three tabs whether or not there is anything behind them.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 51-A | A design, validated in a clickable prototype, for how the two tab strips on a note screen should look and behave | Not Started | — |
| 51-B | The agreed design shipped in the real app | Not Started | 51-A |
| 51-C | A recording keeps running while I read another note | Not Started | 51-A, 51-B |

51-A is a **prototype spike** — its output is a locked design and rewritten scenarios for 51-B, not shipped code. 51-B cannot be specified until 51-A closes, so its scenarios below are placeholders.

**51-C arrived from Phase 49 (was 49-C) on 2026-08-09.** It marks the recording note in the open-note bar and changes which notes stay mounted — the same bar 51-B redesigns and the same `NoteView` tab row. Splitting them across two phases meant two slices restructuring one surface, and the recording marker being designed twice. **51-C runs after 51-B** so it decorates a settled strip; 51-A must still prototype the recording states (below), or 51-B locks a design that 51-C invalidates.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 51-A — Prototype the tab design

- **User value:** The note screen currently stacks **two unrelated tab strips** on top of each other and the lower one lies about what the note contains. Getting this right is a design question, not a coding one, so it gets proved in a throwaway prototype before any real work.
- **The problems to solve** (what the prototype must answer):
  1. **Two tab strips, one screen.** The open-note bar across the top (one tab per note you have open) sits directly above the note's own view tabs. They look similar, mean completely different things, and reading them together is confusing.
  2. **Tabs that are always there whether or not they hold anything.** *Transcript* and *Final notes* are shown on **every** note — a note you have only typed in offers a Transcript tab with nothing in it and a Final notes tab you have to click to discover is empty. The tab strip should signal what the note has.
  3. **Tabs that appear and disappear unpredictably.** Whatever the rule for showing a tab is, it must be legible to the user — a tab that vanishes mid-task is worse than one that is always present but visibly empty.
  4. **They are ugly.** Visual treatment: hierarchy between the two strips, active/inactive states, spacing, and how the recording and paste-transcript controls sitting on the same row relate to them.
- **Two further questions the prototype must settle** (added 2026-08-09):
  5. **Where the open-note bar lives.** Today it shows only while a note is open, so going back to your notes list hides the notes you had lined up. Phase 49 deferred deciding whether it should stay visible on the notes list and folder views as a way back — that is the same hierarchy question as problem 1, so it is answered here rather than parked again. Prototype each direction both ways.
  6. **How a recording note looks in the bar.** 51-C marks the note that is recording so you can see which one is live from any tab. Every direction must show that marker in its own visual language, and must still read correctly when the recording note is *not* the one on screen.
- **How it works:**
  - Run as a throwaway frontend-only prototype on a `prototype/` branch — no backend, no specs, never merged.
  - Present at least three genuinely different directions, not three shades of the current design. Candidate directions to cover: hide-until-populated, always-present-but-visibly-empty (badge/count/dimmed), and collapsing the two strips into a single hierarchy.
  - Each direction is viewable across the note states that change the answer: nothing captured yet, typed notes only, recording in progress, transcript captured but not analysed, and fully analysed.
  - The user picks one; the exit procedure rewrites **this doc's 51-B section** with the confirmed scenarios and UX patterns.
- **Scenarios (GWT):** none — a spike has no acceptance scenarios. Its exit criterion is a design the user has approved and 51-B scenarios written into this doc.

### Slice 51-B — Ship the agreed design

- **User value:** _To be written by the 51-A exit procedure._
- **How it works:** _To be written by the 51-A exit procedure._
- **Scenarios (GWT):** _To be written by the 51-A exit procedure — do not implement from this doc until they exist._

### Slice 51-C — A recording keeps running in a background tab

- **User value:** I can look something up in another note while a meeting is still being recorded, without stopping the recording or losing what's been captured.
- **How it works:**
  - Switching away from a note that is recording no longer asks anything — the recording carries on in the background.
  - The recording tab is marked in the bar so it's obvious which note is live, and clicking it takes you straight back. The marker's visual treatment is whatever 51-A confirmed.
  - Returning to the recording tab shows the whole live transcript, including everything captured while you were elsewhere.
  - Closing a recording tab still asks to confirm, and stops the recording cleanly if you go ahead.
  - Only one recording can run at a time, as today: starting a recording in another tab is not offered while one is live.

- **Scenarios (GWT):**

```
Scenario: Recording continues while I read another note
  Given I am recording in "Standup" and also have "Client call" open
  When  I click the "Client call" tab
  Then  I am not asked to confirm
  And   the "Standup" tab shows that it is still recording

Scenario: The live transcript is complete when I come back
  Given I am recording in "Standup" and I switch to "Client call" while people keep talking
  When  I click back to the "Standup" tab
  Then  the live transcript includes what was said while I was away

Scenario: Closing a recording tab asks first
  Given I am recording in "Standup"
  When  I close the "Standup" tab
  Then  I am asked to confirm
  And   confirming stops the recording and keeps what was captured

Scenario: Only one note records at a time
  Given I am recording in "Standup" and I switch to "Client call"
  When  I look at the recording control in "Client call"
  Then  I cannot start a second recording
```

---

## Build notes _(implementation — skip when reviewing)_

### 51-A
- **Run the `prototype` skill** ([`.claude/skills/prototype/SKILL.md`](../../.claude/skills/prototype/SKILL.md)). Worktree + branch per the CLAUDE.md prototype convention: `git worktree add ../ai-note-taker-slices/prototype-tabs-redesign -b prototype/tabs-redesign` (absolute path).
- **Current state to prototype against:**
  - *Open-note tab bar* — `web/src/components/OpenNoteTabs.tsx`, driven by `useOpenNoteTabs` (Phase 49-A). Deliberately **not** ARIA tabs (`role="tab"` obliges a matching `role="tabpanel"`; the panel here is the whole note screen) — see the comment at `OpenNoteTabs.tsx:7`. Returns `null` when no notes are open.
  - *Note view tabs* — `NoteView.tsx:32-38` (`NoteTab = "quick" | "transcript" | "final"`), rendered at `:746` as a real ARIA `role="tablist"` with three `role="tabpanel"`s at `:785` / `:854` / `:871`.
  - **Confirmed root of problem 2:** `TABS.map(...)` at `NoteView.tsx:747` has **no filter** — all three tabs render unconditionally, regardless of `transcriptText` / `transcriptDraft` / `summary`. The data needed to drive a conditional or badged tab strip is already in scope in the component (`transcriptText`, `transcriptDraft`, `summary`, `discussionPoints`, `decisions`, `isRecording`).
  - Styling lives in the `tabStyles` CSS module shared by the tab row, panels and `tabRowControls` (which hosts `PasteTranscript` + `RecordControl` on the same row as the tabs).
- **This is the second attempt at problem 1, not the first.** 49-A's build notes already instructed Stylist to "give the open-note bar a visually distinct treatment so they don't read as one control", and that shipped — raised chips against underlined text, with the reasoning written into `OpenNoteTabs.module.css:1-4`. It did not work. So a direction that only re-skins the two strips has already been tried; the prototype must change the **hierarchy**, not the palette.
- **Constraint the prototype must respect:** a tab cannot simply disappear while recording — `activeTab` is force-set to `"transcript"` at `NoteView.tsx:474` when a recording starts. Any hide rule has to keep the active tab valid, and must not fight the BUG-34 / BUG-54 recording-leave guards.
- **That constraint gets harder under 51-C, and the prototype must assume the harder version.** Today only the note on screen can record, so "recording ⇒ the Transcript tab is active" holds trivially. 51-C makes a **background** note able to record, so a hide rule has to be correct for a note the user is not looking at, and the open-note bar has to carry per-note recording state. Designing against today's single-mounted-note model would lock a design 51-C then invalidates — which is the whole reason 49-C was folded into this phase.
- **Accessibility:** the note-view strip is a genuine ARIA tablist and must stay one. If a direction merges the two strips, re-check the `role="tab"`/`role="tabpanel"` pairing constraint that drove `OpenNoteTabs`' current markup.
- **Exit procedure:** on approval, cherry-pick **only** the rewritten phase-doc commit to `main`. Never merge `prototype/` into `main` or into a slice branch. Real implementation starts fresh from this doc, not from prototype code.

### 51-B
- _Not specified. Populated by the 51-A exit procedure._
- Expect it to be **frontend-only** (the data driving any conditional/badged tab is already loaded), but confirm at exit — if a direction needs a "has a transcript" or "has final notes" signal the client doesn't already hold, that changes the shape.
- **Two E2E contracts break silently under the likely directions. Both cost a red deploy gate, not a red PR — E2E runs only in the deploy gate.**
  1. **Hide-until-populated kills `NoteTabsJourney`.** `tests/Browser.E2E/Journeys/NoteTabsJourney.cs:33-48` opens a **brand-new empty note** and clicks `note-tab-transcript` to assert the panel swaps rather than stacks. Under that direction the tab does not exist on an empty note, so the journey hunts a missing element to its timeout. The same click is inside `AppPage.AssertImportedTranscriptVisibleAfterReloadAsync` (`AppPage.cs:157`), which re-clicks the tab on every reload attempt — there the transcript *has* been imported, so it survives a populated-only rule, but not a rule keyed on anything narrower. Rewrite both in the same slice as the hide rule.
  2. **Merging the strips breaks the 49-B reload contract.** Nine call sites depend on the open-note bar's markup — `AppPage.cs:330, 342, 347, 353, 360, 372, 873, 890` plus `OpenNoteTabsJourney` — and `data-tabs-reconciled` is load-bearing, not decorative: 49-B's notes record that restored tabs render from storage before the cards read lands, so a bare count assertion can pass on the pre-reconcile DOM and go red a tick later. Any merged markup must still expose a reconciled-set signal, or `AssertOpenTabCountAfterReloadAsync` becomes a coin toss. This is the failure mode BUG-57 already cost one deploy gate for.
- **Vitest coverage to update alongside:** `web/src/__tests__/NoteView.test.tsx` asserts the three-tab strip directly at `:361, 368-370, 384-388, 401, 408, 422, 426, 568, 572, 601, 638, 1213`; `OpenNoteTabsPersistence.test.tsx:243` reads `open-note-tab-label`.
- **Settles 49-A's orphaned deferral.** "Keeping the bar visible on home/folder views as a way back to open notes — revisit after 49-A ships; route to `phase-minor-changes.md` if wanted" was never routed anywhere. 51-A answers it (problem 5); 51-B ships the answer. Do not re-file it.

### 51-C
- **Arrived from 49-C on 2026-08-09.** Build notes below are that slice's, unchanged except where 51-B now owns the visual design.
- **The crux.** This slice changes the mounting model: the recording note's `NoteView` must stay mounted while another tab is active. `useTranscription` (`web/src/hooks/useTranscription.ts:99`) owns the mic stream, the socket and the transcript buffer, and unmounting it is exactly the transcript-loss failure BUG-34 was filed for.
- **Two candidate designs — pick one in a spike/design step before writing code:**
  1. **Keep-mounted:** render the recording note's `NoteView` alongside the active one, hidden (`hidden` attribute / `display:none`), so its hook keeps running. Cheapest diff; risks: duplicate global effects (`beforeunload`, the `popstate` trap, autofocus at `NoteView.tsx:251`) firing from a hidden note, and a hidden Tiptap editor holding state.
  2. **Hoist the session:** move `useTranscription` above the route into a provider keyed by `noteId`, so `NoteView` consumes a session it does not own. Cleaner long-term, larger blast radius in the app's most failure-sensitive component.
  - Either way, every effect in `NoteView` that assumes "mounted ⇒ visible/active" must be audited and gated on active-ness.
- **Remove** the 49-A tab-switch confirm; **keep** the close-tab confirm and the `beforeunload`/`popstate` guards. This drops [CHANGE-33]'s guarded-exit count from 7 to 6 — check that item's copy still reads correctly if it is still open.
- **Bar affordance:** the recording marker on the tab (`aria-label` includes "recording"), driven by the same status the record control uses. **Visual design comes from 51-A and ships in 51-B's strip** — 51-C wires it to real recording state rather than inventing a treatment.
- **Single-recorder rule:** the record control in a non-recording tab is disabled with a reason while another tab is live (today this is implicit — one note is mounted; it becomes explicit here).
- **Tests:** vitest cannot prove "audio kept flowing" — assert the *hook is not torn down* (transcript state survives a tab switch, cleanup not called) and that the control is disabled elsewhere. E2E covers the tab indicator + no-confirm-on-switch; a real audio assertion is out of scope for the gate.
- **Acceptance criteria:**
  - [ ] Switching tabs while recording no longer prompts and does not stop the recording
  - [ ] Returning to the recording tab shows the transcript captured while away
  - [ ] The recording tab is marked as recording in the bar
  - [ ] Closing a recording tab confirms first and stops the recording cleanly
  - [ ] A second recording cannot be started from another tab while one is live

### Observability

Frontend-only, so signals go through `recordRumEvent` (`web/src/rum.ts:10`) — there is no server side to log on.

| Silent failure mode | Slice | Signal |
|---|---|---|
| A hide rule mis-fires and leaves the user unable to reach their transcript — no error, silent by construction | 51-B | `recordRumEvent("noteTabHidden", { tab, reason })` when a tab is withheld, so a wrongly-hidden populated tab is visible in RUM |
| **Recording torn down by a tab switch** — the whole point of 51-C, and invisible until the user finds an empty transcript | 51-C | `recordRumEvent("recordingUnmountedWhileActive", { noteId })` in the transcription cleanup path when status is still recording; this alarm-in-a-log-line is the slice's regression detector |

Run the `observability-brief` skill against 51-B's confirmed scenarios once the 51-A exit writes them — the row above is the one failure mode already visible without them.

### Deploy-time
- 51-A: **zero** — prototype branch, never deployed.
- 51-B and 51-C: expected frontend-only → web deploy, **neutral**. Confirm at 51-A exit; if a direction turns out to need a backend field, the route-contract guardrail applies (a frontend-only deploy against an old backend 404s).
