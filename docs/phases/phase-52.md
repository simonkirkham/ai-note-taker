# Phase 52 — Find in a transcript _(Not Started)_

**Goal:** you can search the transcript of the note you're reading — type a word, see how many times it was said, and jump between each mention.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 52-A  | I can search the open note's transcript and step through every match | Not Started | — |
| 52-B  | `Ctrl+F` jumps straight into that search box when I'm reading a transcript | Not Started | 52-A |

52-A is the whole capability and ships alone. 52-B is the ergonomics layer and is separable because it takes over a browser shortcut — a decision worth landing on its own so it can be reverted without losing the feature.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 52-A — Search the transcript you're reading

- **User value:** an hour-long meeting transcript is a wall of text; I need to find where "budget" was mentioned without reading all of it.
- **How it works:**
  - A search box sits above the transcript, on the Transcript tab of the note, whenever there is a transcript to search.
  - Typing filters nothing away — the transcript stays whole, and **every match is highlighted** in place, so I keep the surrounding conversation.
  - Beside the box: **"3 of 7"** — which match I'm on, and how many there are in total.
  - **Next / previous** buttons step between matches, and the transcript scrolls the current one into view. The current match is highlighted more strongly than the rest.
  - `Enter` goes to the next match, `Shift+Enter` the previous — so I can hold `Enter` and walk the whole transcript without leaving the keyboard.
  - Stepping past the last match wraps around to the first.
  - `Escape` clears the search; the highlights disappear and the transcript is exactly as it was.
  - Matching ignores capitals — searching `budget` finds `Budget`.
  - When nothing matches I'm told so plainly ("No matches"), rather than being left wondering whether it's still thinking.
  - **While a recording is running** the transcript keeps growing and new matches are counted as they arrive — but the view stops auto-scrolling to the bottom while I'm searching, so it doesn't yank me away from the match I'm reading. Clearing the search hands the auto-scroll back.
  - Speaker labels are part of the transcript, so searching a speaker's name finds their turns.

- **Scenarios (GWT):**

```
Scenario: Finding a word in the transcript
  Given I am reading a note whose transcript mentions "budget" three times
  When  I type "budget" into the transcript search box
  Then  all three mentions are highlighted
  And   I am shown that I am on match 1 of 3

Scenario: Stepping to the next match
  Given I have searched the transcript for "budget" and am on match 1 of 3
  When  I choose next
  Then  I am shown that I am on match 2 of 3
  And   that mention is scrolled into view and highlighted as the current one

Scenario: Stepping past the last match wraps around
  Given I have searched for "budget" and am on match 3 of 3
  When  I choose next
  Then  I am back on match 1 of 3

Scenario: Stepping back from the first match wraps to the last
  Given I have searched for "budget" and am on match 1 of 3
  When  I choose previous
  Then  I am on match 3 of 3

Scenario: Searching ignores capitals
  Given the transcript says "Budget" with a capital B
  When  I search for "budget"
  Then  that mention is found and highlighted

Scenario: A word that was never said
  Given I am reading a transcript that never mentions "pineapple"
  When  I search for "pineapple"
  Then  I am told there are no matches
  And   the transcript is shown unchanged with nothing highlighted

Scenario: Clearing the search restores the transcript
  Given I have searched for "budget" and matches are highlighted
  When  I clear the search
  Then  no highlights remain
  And   the transcript reads exactly as it did before I searched

Scenario: There is nothing to search yet
  Given I open a note that has no transcript
  When  I look at the Transcript tab
  Then  no search box is offered

Scenario: Searching during a live recording does not yank the view
  Given a recording is running and the transcript is growing
  When  I search for a word and step to a match part-way up the transcript
  Then  the view stays on that match as new speech arrives
  And   the match count rises if the new speech contains the word

Scenario: Clearing the search during a recording resumes following the speech
  Given I am recording and have cleared the transcript search
  When  new speech arrives
  Then  the transcript follows along at the bottom as it did before
```

### Slice 52-B — `Ctrl+F` opens the transcript search

- **User value:** find-in-page is muscle memory; I shouldn't have to reach for the mouse to search a transcript.
- **How it works:**
  - While I'm on the Transcript tab of a note that has a transcript, `Ctrl+F` (`Cmd+F` on a Mac) puts my cursor in the transcript search box instead of opening the browser's own find bar.
  - If I'd already typed a search, the existing text is selected so I can type straight over it.
  - Anywhere else in the app — the notes list, Quick notes, Final Notes — `Ctrl+F` still opens the browser's find bar as normal. The app only claims the shortcut where it has a better answer.
  - `Escape` clears the search and returns me to reading, as in 52-A.
  - The shortcut is listed in the keyboard-shortcuts panel so it's discoverable.

- **Scenarios (GWT):**

```
Scenario: Ctrl+F focuses the transcript search
  Given I am reading a note's transcript
  When  I press Ctrl+F
  Then  my cursor is in the transcript search box
  And   the browser's own find bar has not opened

Scenario: Ctrl+F with an existing search replaces it
  Given I have already searched the transcript for "budget"
  When  I press Ctrl+F
  Then  my cursor is in the search box with "budget" selected
  And   typing replaces it

Scenario: Ctrl+F elsewhere is left to the browser
  Given I am on the Quick notes tab of a note
  When  I press Ctrl+F
  Then  the app does nothing and the browser's find bar opens as usual

Scenario: Ctrl+F with no transcript is left to the browser
  Given I am on the Transcript tab of a note with no transcript
  When  I press Ctrl+F
  Then  the app does nothing and the browser's find bar opens as usual
```

---

## Build notes _(implementation — skip when reviewing)_

Frontend-only phase. **No new commands, events, projections, endpoints, tables or CDK changes** — the transcript is already fully loaded client-side as a single string prop. `docs/event-model.md`, `docs/event-schemas.md` and `docs/view-schemas.md` are untouched.

### Shared design decisions (read before 52-A)

- **Scope: in-note find only.** This is *not* an extension of Phase 22 search. `NoteSearchView` still deliberately excludes transcript text (`docs/phases/phase-22.md:58`) and this phase does not change that. Indexing transcripts into global search was considered and deferred by the user on 2026-09-08 — filed in [`docs/future-features.md`](../future-features.md).
- **Where it lives:** `TranscriptTab.tsx` (`web/src/components/TranscriptTab.tsx`) + `TranscriptTab.module.css`. `NoteView` passes `transcript` down already (`NoteView.tsx:1052`) — **no prop-signature change for 52-A, no new plumbing through `NoteView`**, and no widening of any shared callback. Search state is local to `TranscriptTab`.
  - **As built:** the controls are their own component (`TranscriptFindBar.tsx` + `.module.css`) — `TranscriptTab` had reached four distinct regions in one file. The search *state* stays in `TranscriptTab` (it drives the highlighting); the bar owns its input focus and key handling. The bar has no test file of its own: every one of its behaviours is asserted through `TranscriptTab.test.tsx`, which exercises it in its real context.
- **Matching is literal, case-insensitive substring — not fuzzy.** Phase 22's Levenshtein/token-set ranking exists to *rank documents*; find-in-page must be predictable and exact or the highlight positions are meaningless. Escape the query before any regex use, or use an `indexOf` loop (preferred — no escaping bug surface). No diacritic folding, no stemming, no whole-word option in this phase.
- **Rendering:** the body currently renders `{transcript}` inside one `<p data-testid="transcription-text">` (`TranscriptTab.tsx:71`) with `white-space: pre-wrap` (`TranscriptTab.module.css`). Highlighting splits it into alternating plain/`<mark>` segments **inside the same `<p>`**, preserving `pre-wrap` (newlines carry the speaker turns). Keep `data-testid="transcription-text"` on that element — existing component tests and any E2E selector depend on it, and its `textContent` must stay byte-identical to `transcript` when highlighting is applied. Assert that.
- **Empty query ⇒ zero work.** No query means render the plain string exactly as today, no `<mark>`s, no memo churn — the untouched path stays the shipped path.
- **Performance:** a 1-hour transcript is ~10k words. `useMemo` the match offsets on `[transcript, query]`; a linear scan is fine and a debounce is not needed. Do **not** re-scan per keystroke *and* per render.
- **Never log or record the query text.** Same privacy discipline as Phase 22 (query text and note content are never logged). This constrains the observability options below.

### 52-A — Find in transcript

- **Events/commands:** none.
- **Projections:** none.
- **API:** none.
- **State:** local to `TranscriptTab` — `query: string`, `currentIndex: number`. Matches are derived (`useMemo`), never stored.
- **Match index stability while recording:** matches are recomputed as `transcript` grows. Appended speech only appends matches, so clamp `currentIndex` to `matches.length - 1` rather than resetting it — a growing transcript must not bounce the user back to match 1.
  - **As built: clamp only.** A replaced, *shorter* transcript (33-B1 diarization swap, 18-C re-record) lands on the last remaining match, which the clamp already gives. Detecting a same-length non-prefix replacement was dropped as over-engineering: the index would point at a different match, which is no worse than resetting, and it needs a previous-transcript ref to detect at all.
- **Auto-scroll interaction (the one real subtlety):** the existing effect force-scrolls to the bottom on every transcript change while `isRecording` (`TranscriptTab.tsx:26-30`). That directly fights scroll-to-current-match. Gate it on `query === ""` — active search suppresses follow-the-speech; clearing restores it. Both scenarios in 52-A assert this pair.
- **Scroll-to-match:** `ref` on the current `<mark>`, `scrollIntoView({ block: "center" })` in an effect on `currentIndex`. Guard for the mark being absent (query cleared in the same tick).
- **A11y (jsx-a11y is a hard CI gate):**
  - Wrap in `role="search"` with the input labelled `Find in transcript` (visible label or `aria-label`).
  - Match count in a `role="status"` live region — announce `"3 of 7"` / `"No matches"`. **The planned ~300ms announcement debounce was dropped:** `role="status"` is already a polite region, so rapid updates are coalesced by the screen reader rather than queued, and debouncing would have desynchronised the announced count from the visible one. The count element is rendered whenever the search box is (empty when idle) so the live region exists before its content changes — a region created at the same moment its text appears is not reliably announced.
  - Next/previous are real `<button>`s with `aria-label="Next match"` / `"Previous match"`, `disabled` when there are no matches.
  - Current `<mark>` gets `aria-current="true"`; others plain.
  - The clear (`✕`) affordance is a real button — and **check BUG-13** (the Phase 22 search bar shipped a double-clear `✕`: the native `type="search"` clear plus a custom one). Use `type="text"` with one explicit clear button, not `type="search"`.
- **Keyboard:** `Enter` → next, `Shift+Enter` → previous, `Escape` → clear + keep focus in the box. These are input-scoped handlers, **not** a `document` listener — that is 52-B's job.
- **`react-hooks/set-state-in-effect`:** no `setState` in an effect body anywhere here — matches are derived, `currentIndex` only moves in event handlers and in a clamp computed during render. Run `npm run lint` on the changed files, not just `tsc`/`vitest` (guardrail: lint catches what `tsc` and vitest do not).
- **Tests (vitest/RTL, `web/src/__tests__/TranscriptTab.test.tsx` — extend the existing file):**
  - no search box when `transcript` is null/blank; box present when it has content
  - typing a term highlights every occurrence; `textContent` of `transcription-text` still equals the raw transcript
  - count renders `1 of 3`; next → `2 of 3`; next×3 wraps to `1 of 3`; previous from 1 wraps to 3
  - case-insensitive match
  - no matches → "No matches", zero `<mark>`s, next/prev disabled
  - clearing removes all `<mark>`s
  - `Enter` / `Shift+Enter` step; `Escape` clears
  - regex metacharacters in the query (`a.b`, `(x)`) are treated literally and do not throw
  - with `isRecording` and a non-empty query, a transcript update does **not** scroll to bottom; with an empty query it does
  - `currentIndex` survives a transcript append (still on match 2 of 4, not reset)
  - **No new E2E journey.** No server contract is exercised, the deploy gate is already flake-sensitive (BUG-38, TI-39), and every assertion here is deterministic in RTL. Component tests are the regression net.
- **Acceptance criteria:**
  - [ ] A search box appears above the transcript only when there is a transcript
  - [ ] Typing highlights every case-insensitive match in place, leaving the transcript text unchanged
  - [ ] The current match is visually distinct from the others and scrolled into view
  - [ ] A "N of M" count is shown and announced to screen readers
  - [ ] Next/previous step between matches and wrap around in both directions
  - [ ] `Enter` / `Shift+Enter` step; `Escape` clears the search
  - [ ] No matches shows an explicit "No matches" state with the transcript unmodified
  - [ ] Clearing the search restores the exact original rendering
  - [ ] An active search suppresses record-mode auto-scroll; clearing it restores auto-scroll
  - [ ] A growing transcript does not reset which match the user is on
  - [ ] Search state is local to the transcript tab — no `NoteView` prop or callback signature changes
- **Decisions:**
  - **The highlight tint is `color-mix(in srgb, var(--color-primary) 35%, transparent)`, not `--color-primary-bg`.** That token is only a 6–12% wash: measured across all 17 themes it sits at **1.07:1** against the surface, so the highlight would have shipped invisible — the entire feature, defeated, with all 34 specs green (the test environment applies no CSS, and the specs assert the mark elements *exist*). At 35% the worst theme measures **5.44:1** for text on the highlight and **1.47:1** for the highlight against the surface. Both states share one background and the current match is distinguished by an outline, so no second colour pairing needs verifying per theme. Re-measure with `scripts/`-style arithmetic over `tokens.css` if the accent tokens change.
  - Previous/next/clear reuse the shared global `.icon-btn` utility rather than a bespoke control — consistent geometry, hover and disabled with every other icon button; only the focus ring is local, as `.icon-btn` defines none.
  - Literal substring over fuzzy — predictability beats recall for find-in-page.
  - Highlight-in-place over filter-to-matching-lines — the user asked to *find* a mention, and context is the reason the transcript is kept at all.
  - No whole-word / regex / match-case toggles in v1; add only if asked (route to `phase-minor-changes.md`).

### 52-B — `Ctrl+F` / `Cmd+F` capture

- **Handler:** a `document`-level `keydown` listener registered by `TranscriptTab`, **only** when the tab is active *and* a transcript exists — mount-gated, following the `ShortcutsPanel` pattern (`web/src/components/ShortcutsPanel.tsx:31`, effect-scoped add/remove with a cleanup).
- **Active-tab problem:** all three note tab panels stay mounted and are hidden via the `hidden` attribute (`NoteView.tsx:1049`), so `TranscriptTab` cannot infer visibility from being mounted. Pass an explicit `isActive` prop from `NoteView` (`activeTab === "transcript"`) — a single new optional boolean prop with a safe default, not a signature change to any shared callback. Without it the shortcut would fire while the user is on Quick notes and silently steal `Ctrl+F` from the editor.
- **Only `preventDefault()` when the app will actually handle it** — active transcript tab, transcript non-empty. Every other case must fall through to the browser untouched; a swallowed `Ctrl+F` with nothing to show is worse than no shortcut. This is why the slice is separable and independently revertable.
- **Don't fight Tiptap:** `Ctrl+F` is not a Tiptap binding, but confirm no editor keymap claims it before shipping.
- **Behaviour:** focus the input and `select()` its contents.
- **Discoverability:** add `Ctrl+F` → `Find in transcript` to the `SHORTCUTS` table (`ShortcutsPanel.tsx:5`).
- **Desktop shell:** the Phase 31 Electron app loads the same bundle, so this works there unchanged; Electron has no native find bar, which makes the capture strictly an improvement there.
- **Tests:**
  - `Ctrl+F` with `isActive` and a transcript → input focused, `defaultPrevented` true
  - `Ctrl+F` with `isActive={false}` → not focused, `defaultPrevented` **false**
  - `Ctrl+F` with no transcript → `defaultPrevented` false
  - `Meta+F` behaves as `Ctrl+F`
  - existing query is selected on re-focus
  - listener is removed on unmount (no leak across notes)
- **Acceptance criteria:**
  - [ ] `Ctrl+F`/`Cmd+F` focuses the transcript search box while the Transcript tab is active and has content
  - [ ] An existing query is selected so typing replaces it
  - [ ] The shortcut is not intercepted on any other tab, or when there is no transcript — the browser find bar opens normally
  - [ ] The listener is removed when the tab is left or the note unmounts
  - [ ] `Ctrl+F` is listed in the keyboard-shortcuts panel

### Observability

Frontend-only, so the only channel is `recordRumEvent` (`web/src/rum.ts:10`) — there is no server side to log on. **The query text and any transcript excerpt must never be sent** (Phase 22 privacy rule), which rules out most of what would otherwise be useful; the honest position is that this feature's regression net is its component tests, not production telemetry.

**As built (52-A): no telemetry was added.** Custom browser events have never actually emitted ([TI-67] — they are disabled on the monitor, and the deployed client swallows the call), so shipping the events below would have added code that provably produces nothing while reading as coverage. The table stays as the design to implement **once TI-67 is closed**. The one silent failure mode that mattered — a highlight nobody can see — was caught by measuring the colours instead, and is recorded as a decision above.

| Silent failure mode | Slice | Signal |
|---|---|---|
| Highlighting corrupts the transcript (a segment dropped or duplicated by the split) — the user reads a subtly wrong transcript and never knows | 52-A | Not detectable in prod without shipping content. Covered instead by the invariant test: highlighted `textContent` === raw transcript. Treat that assertion as the control. |
| Search silently finds nothing because match computation threw (e.g. a regex metacharacter) and was swallowed | 52-A | `recordRumEvent("transcriptFindError", { queryLength })` — **length only, never the text**. Also surfaces the case the "treated literally" test guards. |
| Auto-scroll suppression sticks after the search is cleared, so a live transcript stops following speech | 52-A | No prod signal; asserted by the paired record-mode tests. Flagged here as an accepted blind spot. |
| `Ctrl+F` swallowed with nothing shown — the user loses browser find and gains nothing | 52-B | `recordRumEvent("transcriptFindShortcut", { focused })`; a rising `focused: false` rate means the gating is wrong. |
| Search used heavily on very long transcripts and feels slow | 52-A | `recordRumEvent("transcriptFindUsed", { transcriptLength, matchCount })` — counts only, no content. Also answers whether the feature is used at all before investing in 52-B or fuzzy matching. |

### Deploy-time

**Neutral.** Web-only — no CDK, no Lambda, no new resource, nothing added to the deploy path; `detect-changes` reports `backend=false` and `cdk deploy` is skipped. **No API route is added, moved or renamed**, so the frontend-only-deploy route-contract hazard (Phase 34-B) does not apply — a web-only deploy is safe for this phase. No projection is added, so no backfill is required.
