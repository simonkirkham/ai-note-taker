# Phase 51 — Open-note bar redesign _(In Progress — 51-A, 51-B done 2026-08-10)_

**Goal:** the notes you have open stay in front of you wherever you are in the app, instead of vanishing the moment you go back to your notes list and reappearing all at once when you open something.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 51-A | A design, validated in a clickable prototype, for how the open-note bar should behave | Done | — |
| 51-B | My open notes stay visible on every screen, with my notes list as the first tab | Done | 51-A |
| 51-C | A recording keeps running while I read another note | Not Started | 51-B |

51-A was a **prototype spike**; it closed on 2026-08-10 with direction A locked. 51-B's scenarios below are the confirmed ones it produced.

**Re-scoped during 51-A.** The phase opened as a redesign of the note's own *Quick notes / Transcript / Final notes* tabs. The human corrected it: that strip is fine and is **not changing**. The original problems about empty Transcript / Final notes tabs are **dropped, not deferred** — they described that strip. Do not re-file them.

**51-C arrived from Phase 49 (was 49-C) on 2026-08-09.** It marks the recording note in the same bar 51-B rebuilds. It runs after 51-B so it decorates a settled design; 51-A confirmed the marker's treatment so 51-B does not lock something 51-C invalidates.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 51-A — Prototype the open-note bar _(Done 2026-08-10)_

- **User value:** how the bar should behave across Home is a design question, not a coding one, so it was proved in a throwaway prototype before any real work.
- **Outcome:** four directions built and compared against the current behaviour — a pinned "My notes" tab, an always-present bar with no pinned tab, moving open notes into the sidebar, and today's behaviour as the baseline. **Direction A (pinned "My notes" tab) was chosen**, with the line under the bar removed and the bar merged into the page. Full record, including what was rejected and why: [`web/src/prototype/REFERENCE.md`](https://github.com/simonkirkham/ai-note-taker/blob/prototype/tabs-redesign/web/src/prototype/REFERENCE.md) on the `prototype/tabs-redesign` branch.
- **Scenarios (GWT):** none — a spike has no acceptance scenarios.

### Slice 51-B — My open notes stay visible everywhere _(Done 2026-08-10)_

- **User value:** going back to my notes list no longer hides everything I had open, and opening a note no longer makes a row of tabs appear from nowhere. What I have open is always in the same place.
- **How it works:**
  - The tab bar is on **every** screen — notes list, folders, search and notes alike. It never appears or disappears.
  - The first tab is **My notes**, pinned to the left with a home icon. It has no close button and cannot be closed.
  - **My notes** is the highlighted tab whenever you are not reading a note — on the notes list, inside a folder, and on search results. Clicking it takes you to your notes list.
  - Opening a note highlights that note's tab instead. Everything else in the bar stays exactly where it was.
  - With nothing open, the bar is still there holding just **My notes** — so it is never a surprise when it fills up.
  - With many notes open the strip scrolls sideways, and **My notes** stays pinned in view rather than scrolling away.
  - The line under the bar is gone. The tab you are on and the page below it are one continuous surface, so the tab reads as the sheet in front.

- **Scenarios (GWT):**

```
Scenario: Going back to my notes keeps my open notes in view
  Given I am reading "Standup" and also have "Client call" open
  When  I click the "My notes" tab
  Then  I am on my notes list
  And   "Standup" and "Client call" are both still shown as tabs
  And   "My notes" is the highlighted tab

Scenario: Opening a note changes nothing but the highlight
  Given I am on my notes list with "Standup" and "Client call" open
  When  I open "Standup"
  Then  the same tabs are shown in the same order
  And   "Standup" is the highlighted tab instead of "My notes"

Scenario: The bar is there before I have opened anything
  Given I have no notes open
  When  I go to my notes list
  Then  I see the tab bar holding only the "My notes" tab
  And   "My notes" is the highlighted tab

Scenario: Browsing a folder keeps my notes list highlighted
  Given I have "Standup" open
  When  I open a folder from the sidebar
  Then  "My notes" is the highlighted tab
  And   "Standup" is still shown as a tab

Scenario: Searching keeps my open notes in view
  Given I have "Standup" open
  When  I search for something
  Then  "My notes" is the highlighted tab
  And   "Standup" is still shown as a tab

Scenario: My notes cannot be closed
  Given I have "Standup" open
  Then  the "My notes" tab offers no way to close it

Scenario: Closing my last note leaves the bar in place
  Given I am reading "Standup" and it is the only note I have open
  When  I close the "Standup" tab
  Then  I am on my notes list
  And   the bar is still shown, holding only the "My notes" tab

Scenario: My notes stays reachable with many notes open
  Given I have eight notes open and the tab strip scrolls sideways
  When  I scroll the strip to its far end
  Then  the "My notes" tab is still visible
```

### Slice 51-C — A recording keeps running in a background tab

- **User value:** I can look something up in another note while a meeting is still being recorded, without stopping the recording or losing what's been captured.
- **How it works:**
  - Switching away from a note that is recording no longer asks anything — the recording carries on in the background.
  - The recording tab is marked with a red dot beside its title so it's obvious which note is live, and clicking it takes you straight back.
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

### 51-A _(Done)_
- Ran the `prototype` skill on `prototype/tabs-redesign`. Confirmed design, rejected directions and rationale: `web/src/prototype/REFERENCE.md` on that branch. **Never merge it** — 51-B rebuilds from scratch off the GWTs above.
- Re-scope is recorded above. The note-view strip (`NoteView.tsx:32-38`, the `role="tablist"` at `:746`) is **out of scope for the whole phase** and must not be touched.

### 51-B
- **Frontend-only.** No commands, events, projections, endpoints or CDK. The bar's state already exists (`useOpenNoteTabs`, Phase 49-A/B).
- **The two changes that make the bar permanent:**
  1. `web/src/App.tsx:507` gates the bar on `activeNoteId` — remove the gate; render it inside `styles.appMain` on every route.
  2. `OpenNoteTabs.tsx:29` returns `null` when `tabs.length === 0` — remove it; the pinned tab means the bar is never empty.
- **The pinned tab must NOT carry `data-testid="open-note-tab"`.** Give it its own testid. Two failures otherwise, one of them a suite hang:
  1. Every count assertion shifts by one.
  2. `AppPage.CloseAllTabsExceptAsync` (`AppPage.cs:367`) loops `while OpenNoteTabs.Count > 1` clicking `open-note-tab-close`. The pinned tab has no close button, so the loop never terminates — an E2E **hang**, the failure class that already cost a 44-minute gate ([`docs/learnings/e2e-gate-hang-and-the-diagnostic-that-caused-it.md`](../learnings/e2e-gate-hang-and-the-diagnostic-that-caused-it.md)).
- **`AssertNoOpenTabBarAsync` inverts and must be rewritten in this slice.** `OpenNoteTabsJourney.cs:102` asserts the bar is *gone* after closing the last tab ("with no bar left behind"); under this design it is always present. Replace with "the bar remains, holding only the pinned tab". `AppPage.cs:341` is its only caller.
- **`data-tabs-reconciled` now matters on the list screen.** Restored tabs render from storage before the cards read lands regardless of route, so the provisional-set problem 49-B solved on the note route now exists on every route. Keep the attribute on the bar and keep `AssertOpenTabCountAfterReloadAsync` (`AppPage.cs:861`) as the only cross-reload count path.
- **A11y — keep 49-A's model unchanged:** a labelled `<nav aria-label="Open notes">` of real buttons with `aria-current="page"` on the active one. The pinned tab is another button in the same nav. **No ARIA tablist** — merging the two strips was direction C and was rejected, so the `role="tab"`/`role="tabpanel"` pairing constraint never arises.
- **Sticky pinned tab:** `position: sticky; left: 0` inside the existing `overflow-x: auto` strip, with a z-index above the scrolling tabs.
- **⚠ The merge treatment is an app-wide visual change, not a bar change.** Confirmed treatment: the main content area repaints from `--color-bg` to `--color-surface`, the active tab is surface so tab and page are one sheet, inactive tabs sit on `--color-bg`, and the `border-bottom` on `.bar` (`OpenNoteTabs.module.css`) is removed. That repaint touches **every screen** — note, list, folder, search — across **12 themes in light and dark**, and cards lose contrast where surface now sits on surface. Chosen with that blast radius stated. **Budget a Stylist pass and a full theme sweep**; do not treat this as a one-component change.
- **Vitest to update:** `OpenNoteTabsPersistence.test.tsx:243` reads `open-note-tab-label`; `OpenNoteTabs` component specs assert the empty-state `null` return that this slice removes.
- **Settles 49-A's orphaned deferral.** "Keeping the bar visible on home/folder views — route to `phase-minor-changes.md` if wanted" was never filed anywhere; this slice is the answer. Do not re-file it.
- **Carried out of 51-A undecided — NOT in this slice.** The prototype flagged already-open notes in the notes list (an "Open" pill and a left edge on the card). Never discussed. Route to `phase-minor-changes.md` only if the human asks.

### 51-C
- **Arrived from 49-C on 2026-08-09.** Notes below are that slice's, unchanged except that 51-B now owns the marker's visual design.
- **The crux.** This slice changes the mounting model: the recording note's `NoteView` must stay mounted while another tab is active. `useTranscription` (`web/src/hooks/useTranscription.ts:99`) owns the mic stream, the socket and the transcript buffer, and unmounting it is exactly the transcript-loss failure BUG-34 was filed for.
- **Two candidate designs — pick one in a spike/design step before writing code:**
  1. **Keep-mounted:** render the recording note's `NoteView` alongside the active one, hidden (`hidden` attribute / `display:none`), so its hook keeps running. Cheapest diff; risks: duplicate global effects (`beforeunload`, the `popstate` trap, autofocus at `NoteView.tsx:251`) firing from a hidden note, and a hidden Tiptap editor holding state.
  2. **Hoist the session:** move `useTranscription` above the route into a provider keyed by `noteId`, so `NoteView` consumes a session it does not own. Cleaner long-term, larger blast radius in the app's most failure-sensitive component.
  - Either way, every effect in `NoteView` that assumes "mounted ⇒ visible/active" must be audited and gated on active-ness.
- **Classify every leave-guard site before removing any of them — this is where 51-C can silently re-open [BUG-54].** BUG-54 exists because leaving a recording note destroyed the transcript, and it wrapped ten `requestLeave` sites to prevent that. Keeping the recording mounted removes the *reason* for some of those prompts but not others, and the difference is whether the destination unmounts the recording:

  | Site (`App.tsx` unless noted) | Under keep-mounted | Why |
  |---|---|---|
  | Tab switch, `openNote` | **drop the prompt** | the whole point of the slice — recording stays mounted |
  | Home / folder / Unfiled navigation | **drop the prompt**, IF the recording note stays mounted off-route | otherwise this is BUG-54 again; verify by test, not by reading |
  | Close the recording tab | **keep** | unmounts the recording |
  | Sign out (`awaitTranscript: true`) | **keep** | clears the token, unmounts everything |
  | Workspace switch / create-and-switch (`WorkspaceSwitcher.tsx`, 2 sites) | **keep** | leaves the workspace the note lives in |
  | Move note to another workspace | **keep** | the note survives the move, the transcript does not |
  | `beforeunload` / `popstate` | **keep** | the browser is leaving regardless of mounting |

  Do not drop a prompt on the argument that the recording "should" survive — assert it survives first. The 49-A tab-switch confirm is the only one 51-C is *certain* to remove.
- **[BUG-70] is open and overlaps.** "+ New Note" creates the note server-side *before* the guard runs, so a declined leave leaves an orphan. If 51-C drops the prompt on that path without fixing the ordering, the orphan stops being visible rather than stops happening. Read it before touching `handleNewNote`.
- **Remove** the 49-A tab-switch confirm; **keep** the close-tab confirm and the `beforeunload`/`popstate` guards. This drops [CHANGE-33]'s guarded-exit count from 7 to 6 — check that item's copy still reads correctly if it is still open.
- **Bar affordance:** a pulsing red dot left of the tab title, `aria-label` including "recording", driven by the same status the record control uses. Treatment confirmed in 51-A and shipped in 51-B's bar; this slice wires it to real recording state.
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
| The bar renders on every route now, so a reconcile mass-drop is visible on screens 49-B never covered — and a user on the list screen has no note context to notice it | 51-B | already covered: `tabsDropped` (`{ dropped, remaining }`, 49-B). Confirm it still fires from the list route, not only the note route |
| **Recording torn down by a tab switch** — the whole point of 51-C, and invisible until the user finds an empty transcript | 51-C | `recordRumEvent("recordingUnmountedWhileActive", { noteId })` in the transcription cleanup path when status is still recording; this alarm-in-a-log-line is the slice's regression detector |

Run the `observability-brief` skill against 51-B's scenarios before implementation.

### Deploy-time
- 51-A: **zero** — prototype branch, never deployed.
- 51-B and 51-C: **neutral.** Web-only — `detect-changes` reports `backend=false` and `cdk deploy` is skipped. **No API route is added, moved or renamed**, so the frontend-only-deploy route-contract hazard (Phase 34-B) does not apply.
