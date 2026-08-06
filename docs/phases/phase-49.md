# Phase 49 — Open multiple notes at once _(In Progress — 49-A done 2026-07-28)_

**Goal:** you can keep several notes open at the same time and switch between them from a tab bar, instead of losing the note you were on every time you open another.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 49-A  | I can have several notes open at once and click between them in a tab bar | Done | — |
| 49-B  | My open notes are still there after I reload or come back later | In Progress | 49-A |
| 49-C  | A recording keeps running while I read another note | Not Started | 49-A |

49-A proves the whole flow (open, switch, close) and is shippable alone. 49-B and 49-C are independent of each other and can run in either order — 49-B is much the cheaper of the two.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 49-A — Tab bar: several notes open at once

- **User value:** I can open a second note without losing the first, and hop between them in one click.
- **How it works:**
  - Opening a note from anywhere (home card, folder, search, a meeting, a link inside another note) adds it to a **tab bar** across the top of the note view and makes it the active tab.
  - Each tab shows the note's title. The active tab is visually distinct; the note below is exactly the note view as it is today.
  - Clicking a tab switches to that note immediately. The address bar follows the active tab, so refreshing, bookmarking and browser Back/Forward all still land on the note you're looking at.
  - Opening a note that's **already open** just jumps to its tab — no duplicate.
  - Each tab has a `×`. Closing the active tab moves to the next tab along (or the previous one if it was last). Closing the final tab goes back to the notes list.
  - Going back to the notes list leaves the tabs open — opening any note brings the bar back with them.
  - Many tabs scroll sideways rather than shrinking to unreadable slivers.
  - Tabs belong to the workspace you're in; another workspace has its own set.
  - **Recording is protected:** switching to another tab while a recording is running asks the same "save and leave?" confirmation the Back button asks today, rather than silently dropping the recording. (49-C removes the need to ask.)

- **Scenarios (GWT):**

```
Scenario: Opening a second note keeps the first one open
  Given I have opened a note called "Standup"
  When  I go back to the notes list and open a note called "Client call"
  Then  I see tabs for both "Standup" and "Client call"
  And   "Client call" is the active tab and its content is shown

Scenario: Switching back to an earlier tab
  Given I have "Standup" and "Client call" open and "Client call" is active
  When  I click the "Standup" tab
  Then  the "Standup" note is shown
  And   the address bar points at "Standup"

Scenario: Opening an already-open note does not duplicate it
  Given I have "Standup" and "Client call" open and "Client call" is active
  When  I go back to the notes list and open "Standup" again
  Then  there are still exactly two tabs
  And   "Standup" is the active tab

Scenario: Closing a tab I am not looking at
  Given I have "Standup" and "Client call" open and "Client call" is active
  When  I close the "Standup" tab
  Then  only "Client call" remains open
  And   I am still looking at "Client call"

Scenario: Closing the tab I am looking at
  Given I have "Standup" and "Client call" open and "Client call" is active
  When  I close the "Client call" tab
  Then  "Standup" is shown and is the only tab left

Scenario: Closing the last tab returns me to my notes
  Given I have only "Standup" open
  When  I close the "Standup" tab
  Then  I am back on the notes list
  And   no tab bar is shown

Scenario: Typing is saved when I switch tabs
  Given I have "Standup" and "Client call" open and I have typed into "Standup"
  When  I switch to "Client call" and back to "Standup"
  Then  my typing is still there

Scenario: Switching tabs mid-recording asks first
  Given I am recording in "Standup" and also have "Client call" open
  When  I click the "Client call" tab
  Then  I am asked to confirm before leaving the recording
  And   choosing to stay keeps me in "Standup" with the recording running
```

### Slice 49-B — Open notes survive a reload

- **User value:** a refresh (or coming back to the app later on the same device) doesn't wipe out the notes I had lined up.
- **How it works:**
  - The set of open tabs is remembered on this device.
  - Reloading the page brings the tabs back, with the same one active (the address bar already names it).
  - The tab bar shows while you have a note open. Coming back later and landing on the notes list, you see it again as soon as you open any note.
  - A tab whose note has since been deleted, or moved to another workspace, is quietly dropped on restore rather than showing a dead tab.
  - If the browser won't let the app remember anything (private mode, storage full), everything still works — the tabs just start empty.
  - This is per device: it does not follow you to your phone or another browser.

- **Scenarios (GWT):**

```
Scenario: Tabs come back after a reload
  Given I have "Standup" and "Client call" open with "Client call" active
  When  I reload the page
  Then  both tabs are still there
  And   "Client call" is still the active one

Scenario: My notes list failing to load does not close my tabs
  Given I have "Standup" and "Client call" open
  When  I reload and my notes fail to load
  Then  both tabs are still there

Scenario: A deleted note does not come back as a tab
  Given I have "Standup" and "Client call" open
  And   "Standup" has since been deleted
  When  I reload the page
  Then  only "Client call" is open
  And   I see no error

Scenario: Each workspace remembers its own tabs
  Given I have "Standup" open in my first workspace
  When  I switch to another workspace
  Then  no tabs from the first workspace are shown

Scenario: Storage being unavailable does not break the app
  Given my browser will not let the app store anything
  When  I open two notes and reload
  Then  the app works normally with no tabs restored
```

### Slice 49-C — A recording keeps running in a background tab

- **User value:** I can look something up in another note while a meeting is still being recorded, without stopping the recording or losing what's been captured.
- **How it works:**
  - Switching away from a note that is recording no longer asks anything — the recording carries on in the background.
  - The recording tab is marked in the bar (a recording dot) so it's obvious which note is live, and clicking it takes you straight back.
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

Frontend-only phase. **No new commands, events, projections, endpoints or CDK changes** — `docs/event-model.md` and `docs/event-schemas.md` are unchanged and were deliberately not touched. Tab state is client-side (49-A in memory, 49-B in `localStorage`).

### Shared design decisions (read before 49-A)

- **Only the active tab's `NoteView` is mounted.** Tabs are `{ noteId, title }` records; switching tabs is the existing `navigate` to `/w/:wsId/notes/:noteId`, and `NoteRoute` keeps `<NoteView key={noteId}>` so the mount/unmount lifecycle is byte-for-byte what ships today (`web/src/App.tsx:388`). This is what makes 49-A small and keeps 49-A/B free of recording risk. 49-C is the *only* slice that changes the mounting model.
- **Naming.** The new component is `OpenNoteTabs` (`OpenNoteTabs.tsx` + `.module.css`). It must **not** reuse or extend `NoteTabs.module.css` — that styles the *in-note* Transcript / Quick notes / Final Notes tabs (Phase 15, imported as `tabStyles` at `web/src/components/NoteView.tsx:24`) and will sit directly below the new bar. Two adjacent tab rows: give the open-note bar a visually distinct treatment (Stylist call) so they don't read as one control.
- **Single choke point.** Every entry point already funnels through `openNote` (`web/src/App.tsx:159`) via the `onOpenNote` prop — `ListView`/`NoteCard`, `MeetingsSection` (`:151`, `:171`, `:455`, `:484`), `FolderPreviewPanel` (`App.tsx:328`), and `NoteView` itself (`:376`, the `/ai` note-creating path). Adding a tab is a one-line addition inside `openNote`; no call site changes signature. Do **not** widen the `onOpenNote` signature — the whole-codebase cascade that guardrail warns about is avoidable here.
- **Scope of the bar:** rendered on the `notes/:noteId` route only, inside `styles.appMain` above the `<Routes>` outlet's note element. _Deferred (considered, not built): keeping the bar visible on home/folder views as a way back to open notes — revisit after 49-A ships; route to `phase-minor-changes.md` if wanted._
- **No tab cap.** Inactive tabs cost a title string, not a mount, so a cap would be arbitrary. The bar scrolls horizontally (`overflow-x: auto`, per-tab `max-width` + ellipsis).
- **Title source:** the `cards` list already in `App` (`useNoteCards`), same lookup `NoteRoute` uses for `initialTitle` (`App.tsx:391`); fall back to the stored title, then `"Untitled note"`. A rename re-derives when the cards cache refetches (`handleBackFromNote` already triggers it) — no separate title sync.

### 49-A — Tab bar
- **State:** `useOpenNoteTabs(wsId)` hook — `{ tabs: {noteId,title}[], activeNoteId, open(noteId,title), close(noteId), }`. Held in `App` (in-memory `useState` for this slice); the active tab is **derived from the route**, never stored twice.
- **Open semantics:** `openNote` adds the id if absent (append to the end) and navigates. Already-present → navigate only.
- **Close semantics:** close non-active → drop from the list, no navigation. Close active → navigate to the neighbour (next, else previous); last tab → `navigate(w(""))`.
- **Recording guard — resolved: the popstate trap does NOT cover it.** A tab click is a router `navigate`, which pushes; it never fires `popstate`, so the BUG-34 trap (`NoteView.tsx:263`) is blind to it and the capture would have died silently. Shipped as the fallback the plan anticipated: `NoteView` registers a guard (`onRegisterLeaveGuard`) *only while recording*; `App.requestLeave` calls it before navigating, the guard returns `false` to take over and shows the **existing** `confirmingLeave` UI, then resumes the caller's navigation via a stored `proceed` — so "Leave & save" lands on the tab the user actually clicked, not the workspace home. Closing the active tab goes through the same guard (it unmounts the note just the same). Self-requested leaves (Save/back) are unchanged.
- **Content safety:** no new save path needed. `handleSaveContent` flushes on blur *and* on unmount (`NoteView.tsx:294–325`), and tab-switching unmounts, so the "typing is saved when I switch tabs" scenario should pass on the existing flush — assert it, don't re-implement it.
- **A11y — NOT ARIA tabs (changed during build).** `role="tab"` obliges a matching `role="tabpanel"`, and the only candidate panel is the note screen's own `<main>` landmark; relabelling that is worse for a screen reader than plain navigation. Shipped as a labelled `<nav aria-label="Open notes">` of real `<button>`s with `aria-current="page"` on the active one — same information, native focus order, no roving-tabindex machinery. Close button is a real `<button>` with `aria-label="Close <title>"`.
- **Stale tabs:** deleting a note (from the note screen or from a card) and moving one to another workspace both close its tab — a tab pointing at a note no longer in this workspace can only reach the dead-link recovery.
- **Tests:**
  - E2E (primary): open note A from a home card → back → open note B → assert two tabs → click tab A → assert A's content and URL → close A → assert one tab. **Drive it through the home card list (`/notes/cards`, consistency-token gated), never through search** — `/notes/search` has no gate and flakes the deploy gate (CHANGE-23 / deploy #633). Tab state itself is client-side in 49-A, so no reload-tolerance wrapper is needed for the tab assertions. **49-B ends that** — the restored set is reconciled against the projector-backed cards list, so any count asserted across a reload goes through `AssertOpenTabCountAfterReloadAsync` (re-gated + reload-tolerant); only within-page assertions can use the plain helpers.
  - Component (vitest): `OpenNoteTabs` render/active/close; `useOpenNoteTabs` open/dedupe/close-neighbour/close-last.
  - `App` integration test: opening two notes yields two tabs; the recording guard scenario.
- **Acceptance criteria:** _(all met — PR #410, deploy 30402913987)_
  - [x] Opening a second note leaves the first open and shows both as tabs
  - [x] Clicking a tab shows that note and updates the address bar
  - [x] Opening an already-open note focuses its tab instead of duplicating it
  - [x] Closing a non-active tab removes it and leaves the current note in place
  - [x] Closing the active tab moves to the neighbouring tab; closing the last returns to the notes list
  - [x] Content typed in a tab is saved when switching away and is present on return
  - [x] Switching tabs while recording shows the existing leave confirmation; declining keeps the recording running
  - [x] Tabs are keyboard-navigable and screen-reader labelled
- **Added during review** (not in the original criteria, found by Hawk):
  - [x] The note in the URL is always shown as a tab — a cold deep-link, or Back onto a note whose tab was closed, no longer renders a bar with no active tab (or no bar at all)
  - [x] `openNote` goes through the leave guard too — it is reachable from inside a recording note (`/ai` create, next occurrence)
  - [x] Tabs keyed per workspace, so a close in one no longer discards another's set
- **Known accepted trade:** with `openNote` guarded, "Next occurrence" / `/ai` create the note server-side *before* the guard resolves, so declining the leave leaves an unopened note in the list. Preferred over silently killing the recording; revisit if those paths gain their own confirm.

### 49-B — Persist open tabs
- **Storage:** `localStorage`, key `note-taker-open-tabs-<wsId>` (matches the existing `note-taker-theme` / `note-taker-keep-audio-local` naming) (follows the `useTheme` / `useKeepAudioLocal` pattern — `try/catch` on both read and write, degrade to session-only, never throw: `web/src/hooks/useTheme.ts:48`, `useKeepAudioLocal.ts:14`). Value `{ tabs: [{noteId,title}], activeNoteId }`. Per workspace by key, which satisfies the "each workspace remembers its own tabs" scenario with no extra logic.
- **Restore:** hydrate on mount; reconcile against the `cards` list once it loads and drop any `noteId` not present (covers deleted **and** moved-to-another-workspace). Reconcile only *after* cards have loaded — dropping tabs against an empty in-flight list would wipe them on every cold start.
- **Active tab on restore:** the URL wins when the user cold-links to a note; the stored `activeNoteId` only applies when landing on the note route with no id (i.e. not at all today) or when restoring on the same URL. Keep it simple: restore the *list*, let the route decide active.
- **Corrupt/legacy value:** parse defensively; any failure → treat as empty.
- **E2E precondition (from the 49-A review):** creating a note opens it, so a journey's own fixture notes arrive as tabs. Today they are wiped by the reload inside `AssertNoteVisibleInListAfterReloadAsync`; **persisting tabs makes that stop being true**, so any exact tab-count assertion silently becomes wrong. 49-A already normalises via `AppPage.CloseAllTabsExceptAsync` — keep using it, and re-check every tab assertion in `OpenNoteTabsJourney` when the persistence lands.
- **Tests:** vitest with a mocked/`throw`ing `localStorage` for the unavailable case; restore-drops-deleted-note case seeded via the cards handler. No E2E needed beyond a reload assertion appended to the 49-A journey (reload → tabs still present).
- **Acceptance criteria:**
  - [x] Reloading restores the open tabs
  - [x] A tab whose note no longer exists in the workspace is dropped silently on restore
  - [x] Tabs are scoped per workspace
  - [x] Storage being unavailable or corrupt leaves the app fully working with no tabs restored — **scoped to the tab feature and the `AppGate` deep-link restore.** Not ticked for the app as a whole: the auth/calendar paths still have four unguarded storage reads, one of them evaluated during render, so private mode still crashes the tree on an OAuth return ([BUG-58])
  - [x] A failed note-list read does not close the tabs — only a *successful* read is evidence a note is gone
- **Reconcile is DERIVED, not stored (changed during build).** Dropping dead tabs by writing state needs an effect, and an effect that runs before `cards` arrives wipes every tab on every cold start — the exact failure the build notes warn about. Filtering in the existing `openNoteTabs` memo, only once a cards read has succeeded, makes that impossible by construction. Cost: storage keeps a dead id until the next write; it is filtered on every restore, so it is never visible.
- **"A read has succeeded" is `dataUpdatedAt > 0` — not `isLoading`, not `isSuccess` (both wrong, in opposite directions).** A *failed* read also stops loading, with no data, so `!isLoading` collapses the whole bar on one API blip. And query-core's error reducer sets status `"error"` unconditionally, even when `data` still holds the last good list — so `isSuccess` stops reconciling after any failed background refetch, and a note deleted on another device reappears as a tab. `dataUpdatedAt` is stamped only by a success and survives a later error, so the last good snapshot keeps governing.
- **No cap on restored tabs (tried and reverted during review).** A 50-tab restore cap was added to bound a hand-edited value, but writes were uncapped — so 60 open tabs became 50 on reload and the persist effect wrote the truncation straight back: silent, permanent loss, and a contradiction of 49-A's explicit "no tab cap" decision. What actually bounds a hostile value is the cards reconcile (unknown ids are dropped anyway). The **dedupe stays** — duplicate ids are a correctness bug (duplicate React keys, two tabs both marked current), not untidiness.
- **The note being viewed is never dropped** even if the cards list hasn't caught up — it is open by definition.
- **`data-tabs-reconciled` on the tab bar.** Restored tabs render from storage *before* the cards read lands, so the set on screen is provisional. E2E needs a way to wait for the reconciled set — awaiting the response is not awaiting the render, and a bare count assertion can pass on the pre-reconcile DOM and go red a tick later. The attribute makes that transition observable.
- **Two browser tabs on one device are last-writer-wins.** Both windows share the storage key and there is no `storage`-event listener, so opening a note in window B can be erased by the next write from window A. Accepted: the feature is explicitly per-device convenience, not synced state, and a listener would add cross-window reconciliation for a case that loses nothing but a tab entry.
- **Observability (both signals shipped):** `tabRestoreFailed` (`{ reason: storageUnavailable | corrupt | wrongShape }`) fires where the restore gives up, and `tabsDropped` (`{ dropped, remaining }`) fires from an effect — not the memo, which stays pure — when the reconcile removes any tab, de-duplicated by signature so a refetch does not re-report the same drop. Both states are otherwise completely silent; a mass drop is the difference between "the user had no tabs" and "the app lost them".
- **Found + fixed en route:** `AppGate`'s `postLoginRedirect` read of `sessionStorage` was unguarded, so a browser that refuses storage (private mode) **crashed the app on mount** — a direct violation of this slice's own "storage unavailable" criterion. Now try/caught (losing the deep-link restore is the right degradation).
- **Test-isolation fix:** persisting to `localStorage` made it leak between vitest tests (a tab opened in one restored in the next), which red-flagged a 49-A spec. Cleared globally in `web/src/test/setup.ts` alongside the existing URL and workspace resets — the third instance of that same class.

### 49-C — Recording survives a tab switch
- **The crux.** This slice changes the mounting model: the recording note's `NoteView` must stay mounted while another tab is active. `useTranscription` (`web/src/hooks/useTranscription.ts:99`) owns the mic stream, the socket and the transcript buffer, and unmounting it is exactly the transcript-loss failure BUG-34 was filed for.
- **Two candidate designs — pick one in a spike/design step before writing code:**
  1. **Keep-mounted:** render the recording note's `NoteView` alongside the active one, hidden (`hidden` attribute / `display:none`), so its hook keeps running. Cheapest diff; risks: duplicate global effects (`beforeunload`, the `popstate` trap, autofocus at `NoteView.tsx:251`) firing from a hidden note, and a hidden Tiptap editor holding state.
  2. **Hoist the session:** move `useTranscription` above the route into a provider keyed by `noteId`, so `NoteView` consumes a session it does not own. Cleaner long-term, larger blast radius in the app's most failure-sensitive component.
  - Either way, every effect in `NoteView` that assumes "mounted ⇒ visible/active" must be audited and gated on active-ness.
- **Remove** the 49-A tab-switch confirm; **keep** the close-tab confirm and the `beforeunload`/`popstate` guards.
- **Bar affordance:** recording dot on the tab (`aria-label` includes "recording"), driven by the same status the record control uses.
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
| Tab restore silently yields nothing (storage blocked/quota/corrupt) — user thinks the app "forgot" | 49-B | `recordRumEvent("tabRestoreFailed", { reason })` in the storage `catch` and on a parse failure |
| Tabs silently dropped by reconcile (mass-drop = cards loaded empty, i.e. a bug, not deletions) | 49-B | `recordRumEvent("tabsDropped", { dropped, remaining })` when reconcile removes any tab |
| A tab points at a note that 404s — the existing dead-link path, now reachable from a stale stored tab | 49-A/B | already covered: `deadNoteLink` (`App.tsx:382`); confirm it still fires from a tab-driven open |
| **Recording torn down by a tab switch** — the whole point of 49-C, and invisible until the user finds an empty transcript | 49-C | `recordRumEvent("recordingUnmountedWhileActive", { noteId })` in the transcription cleanup path when status is still recording; this alarm-in-a-log-line is the slice's regression detector |
| Tab count growing without bound (a dedupe bug looks like normal use) | 49-A | include `tabCount` on the tab-open event |

### Deploy-time

**Neutral.** Web-only change — no CDK, no Lambda, no new resource, nothing added to the deploy path; `detect-changes` will report `backend=false` and skip `cdk deploy`. **No API route is added, moved or renamed**, so the frontend-only-deploy route-contract hazard (Phase 34-B) does not apply here — a web-only deploy is safe for this phase.
