# Phase 11 — UI Polish

**Goal:** A collection of targeted UX improvements that make the app feel faster and more intentional to use. No new aggregates — these are frontend-focused slices that build on what already exists.

**Learning surface:** Component-level autocomplete patterns in React; client-side ranking and relevance algorithms; accessible keyboard navigation in custom dropdowns; optimistic UI for cross-screen interactions.

---

## Slice order and dependencies

```
11-A  Tag autocomplete ─────────────────────────────────────── independent
11-B  Add To Do from home screen ──────────────────────────── independent
11-C  Delete blank note on cancel ──────────────────────────── independent
11-D  Token expiry and silent refresh ──────────────────────── independent
```

---

## Slice 11-A — Tag autocomplete and suggestions

**Status:** Not Started

**Value:** Tag entry becomes fast and consistent. Typing the first few characters surfaces matching tags from the existing vocabulary so users don't create near-duplicates ("job-hunting" vs "JobHunting"). When the input is empty, the most-used tags appear as one-click shortcuts; notes that already have tags get a curated "Related" list derived from tag co-occurrence.

**Backend changes:** None. `GET /tags` already returns every tag with `noteCount` and `noteIds[]`. The frontend fetches this index once on mount and does all ranking client-side.

---

### How the suggestions work

**When the user is typing:**

1. **Prefix matches** — tags that begin with the typed prefix (case-insensitive), ordered by `noteCount` descending.
2. **Substring matches** — tags that contain but do not start with the prefix (case-insensitive), ordered by `noteCount` descending.

The two groups are shown in order (prefix first) with no heading. Together they form a deduplicated, ranked list. Already-applied tags on the current note are excluded at every step.

**When the input is empty (focus state):**

- **Common** — top 8 tags by `noteCount`, excluding already-applied tags. Shown with a "Common" heading.
- **Related** — shown only when the note already has at least one tag. Algorithm:
  1. Collect `noteIds` from every already-applied tag using the in-memory tag index.
  2. For every tag in the index, count how many of its `noteIds` overlap with that set.
  3. Remove already-applied tags and any tag with zero overlap.
  4. Sort descending by overlap count; take the top 5.
  - Shown with a "Related" heading, above Common.

**Keyboard behaviour:**

| Key | Action |
|-----|--------|
| `↓` / `↑` | Move highlight through the dropdown |
| `Tab` or `→` (when a suggestion is highlighted) | Complete the input with the highlighted tag |
| `Tab` (nothing highlighted, suggestions open) | Complete with the first suggestion |
| `Enter` | Submit the current input text (same as today) if nothing is highlighted; submit the highlighted suggestion if one is |
| `Escape` | Close the dropdown; do not change the input |

Mouse click on a suggestion submits that tag immediately (same as pressing Enter on it).

The dropdown closes after any submission and when focus leaves the input.

---

### Key implementation files

- `web/src/components/TagsSection.tsx` — rewrite to accept `allTags: TagIndexEntry[]`; add dropdown state; keyboard nav; Tab completion
- `web/src/hooks/useTagSuggestions.ts` — new hook: derives the ranked suggestion list from `(input, allTags, appliedTags)`; memoised with `useMemo`
- `web/src/components/NoteView.tsx` — pass `allTags` down to `<TagsSection />`; fetch from `getTags()` on mount (or receive from parent if already fetched)

---

### Scenarios

```
Scenario: Prefix match narrows suggestions
  Given existing tags include "JobHunting" and "JavaScript"
  When  I type "Job" in the tag input
  Then  "JobHunting" appears in the suggestion list
  And   "JavaScript" does not appear

Scenario: Substring match shown after prefix matches
  Given existing tags include "Hunting" and "JobHunting"
  When  I type "hunt" in the tag input
  Then  "Hunting" appears before "JobHunting" in the list
  And   both are visible

Scenario: Tab completes with the top suggestion
  Given "JobHunting" is the first suggestion
  When  I press Tab
  Then  the input is filled with "JobHunting"
  And   the dropdown closes
  And   the input is not yet submitted

Scenario: Tab submits the completed tag
  Given the input reads "JobHunting" after Tab-completion
  When  I press Tab again
  Then  "JobHunting" is added as a tag on the note
  And   the input clears

Scenario: Common tags shown on empty focus
  Given the note has no tags
  And   existing tags include "Work" (5 notes) and "Personal" (3 notes)
  When  I focus the tag input without typing
  Then  "Work" appears before "Personal" in the Common suggestions

Scenario: Related tags shown when note already has tags
  Given the note has tag "Project-Alpha"
  And   other notes tagged "Project-Alpha" also have tags "Design" and "Sprint"
  When  I focus the tag input without typing
  Then  "Design" and "Sprint" appear under a Related heading

Scenario: Already-applied tags excluded from all suggestion lists
  Given the note already has the tag "Work"
  When  I view suggestions (empty input or typing)
  Then  "Work" does not appear in the list

Scenario: Keyboard navigation moves the highlight
  Given the dropdown shows three suggestions
  When  I press ↓ twice
  Then  the third suggestion is highlighted

Scenario: Enter on a highlighted suggestion submits that tag
  Given the second suggestion "Design" is highlighted
  When  I press Enter
  Then  "Design" is added as a tag
  And   the input clears and the dropdown closes

Scenario: Escape closes the dropdown without changing the input
  Given the dropdown is open with input "Jo"
  When  I press Escape
  Then  the dropdown closes
  And   the input still reads "Jo"

Scenario: Clicking a suggestion submits it immediately
  Given "Design" appears in the suggestion list
  When  I click "Design"
  Then  "Design" is added as a tag and the dropdown closes
```

---

### Acceptance criteria

- [ ] Typing in the tag input shows a ranked dropdown (prefix matches above substring matches, each group sorted by `noteCount` desc)
- [ ] Tab on an open dropdown completes the input with the top (or highlighted) suggestion; pressing Tab again submits it
- [ ] `↑` / `↓` navigate the dropdown; highlighted item wraps at top/bottom
- [ ] Enter submits the highlighted suggestion (or the raw input if nothing is highlighted)
- [ ] Escape closes the dropdown without submitting
- [ ] Clicking a suggestion submits it
- [ ] Empty focus state shows Common (top 8 by count) and Related (top 5 by co-occurrence, only when note has tags)
- [ ] Already-applied tags never appear in suggestions
- [ ] `useTagSuggestions` is a pure function of `(input, allTags, appliedTags)` — no side effects, testable in isolation
- [ ] All existing `TagsSection` component tests remain green
- [ ] New component tests cover: prefix ranking, substring ranking, Tab completion, keyboard nav, Related algorithm, exclusion of applied tags

---

## Slice 11-B — Add To Do from the home screen

**Status:** Not Started

**Value:** Users can capture a to-do item without navigating away from the home screen. A compact input in the To Do section lets you type a description and hit Enter (or click Add) to create the action item immediately. The new item appears at the top of the open list optimistically; if the API call fails the item is removed and an inline error message is shown.

**Backend changes:** None. `POST /todos` already exists and accepts `{ description }`. The note the item is attached to is a user choice — see UX below.

---

### UX design

The To Do panel on the home screen gains a single-line "Add a to-do…" text input pinned above the open items list. The input is always visible (not hidden behind a button).

**Note association:** Action items must belong to a note. When the user types in the home-screen input and submits:

1. A "Quick Capture" note is used as the target — this is a special note titled **"Quick Capture"** that is created automatically (via `POST /notes`) the first time a home-screen to-do is added, then reused on subsequent calls. Its ID is cached in component state for the session. The note is never surfaced in the main note list (it is filtered out by the frontend using a well-known title constant `QUICK_CAPTURE_NOTE_TITLE = "Quick Capture"`).

**Optimistic UI:** The item is added to the open list immediately with a temporary client-side ID. On API success the temporary ID is replaced with the real one. On failure the item is removed and an inline error banner appears beneath the input.

---

### Key implementation files

- `web/src/components/HomeScreen.tsx` (or equivalent) — add the `QuickCaptureTodoInput` component to the To Do panel
- `web/src/components/QuickCaptureTodoInput.tsx` — new component: input + submit button; owns optimistic state, API call, error display
- `web/src/api/todos.ts` — existing API client; no changes needed
- `web/src/api/notes.ts` — existing API client; `createNote` reused for Quick Capture note creation

---

### Scenarios

```
Scenario: Add a to-do from the home screen
  Given I am on the home screen
  And   the To Do panel is visible
  When  I type "Buy milk" in the to-do input and press Enter
  Then  "Buy milk" appears at the top of the open to-do list immediately
  And   the input clears and is ready for the next item

Scenario: Optimistic item replaced with real item on success
  Given I have submitted "Buy milk" from the home screen
  When  the API responds successfully
  Then  "Buy milk" remains in the list with its server-assigned ID

Scenario: Optimistic item removed on API failure
  Given I have submitted "Buy milk" from the home screen
  When  the API call fails
  Then  "Buy milk" is removed from the list
  And   an error message is shown beneath the input

Scenario: Quick Capture note created on first use
  Given no Quick Capture note exists for this user
  When  I add a to-do from the home screen for the first time
  Then  a note titled "Quick Capture" is created automatically
  And   the to-do is attached to that note

Scenario: Quick Capture note reused on subsequent adds
  Given a Quick Capture note already exists from a previous session
  When  I add another to-do from the home screen
  Then  no new note is created
  And   the to-do is attached to the existing Quick Capture note

Scenario: Quick Capture note not shown in the note list
  Given a Quick Capture note exists
  When  I view the note list or sidebar
  Then  "Quick Capture" does not appear

Scenario: Empty input is not submitted
  Given the to-do input is empty
  When  I press Enter or click Add
  Then  nothing is submitted and no error is shown

Scenario: Add button submits the input
  Given I have typed "Call dentist" in the to-do input
  When  I click the Add button
  Then  "Call dentist" appears at the top of the open to-do list
  And   the input clears
```

---

### Acceptance criteria

- [ ] An "Add a to-do…" input is always visible in the To Do panel on the home screen
- [ ] Pressing Enter or clicking Add submits the item; empty input is a no-op
- [ ] The new item appears at the top of the open list immediately (optimistic update)
- [ ] On API success the temporary ID is replaced with the real ID; item stays in place
- [ ] On API failure the item is removed and an inline error message is shown beneath the input
- [ ] A Quick Capture note is created automatically on first use and reused thereafter
- [ ] The Quick Capture note is filtered out of the note list and sidebar
- [ ] The input clears after a successful submission and focus returns to the input
- [ ] Component tests cover: submit on Enter, submit on click, empty-input no-op, optimistic add, rollback on failure, Quick Capture note creation, Quick Capture note reuse, filter from note list

---

## Slice 11-C — Delete blank note on cancel

**Status:** Done

**Value:** Clicking Cancel on a freshly-created note that the user never filled in no longer leaves a ghost blank entry in the notes list.

**Backend changes:** None. `DELETE /notes/:id` already exists.

---

### Scenarios

```
Scenario: Canceling a new blank note deletes it
  Given I have just created a new note
  And   I have not entered any title, content, tags, or actions
  When  I click Cancel
  Then  the note is deleted
  And   I am returned to the previous screen

Scenario: Confirming discard on a new note deletes it
  Given I have just created a new note
  And   I have entered some content
  When  I click Cancel
  And   I confirm in the "Discard this note?" dialog
  Then  the note is deleted
  And   I am returned to the previous screen

Scenario: Canceling an existing note does not delete it
  Given I am editing an existing note (not newly created)
  When  I click Cancel and confirm in the discard dialog
  Then  I am returned to the previous screen
  And   the note is not deleted
```

---

### Key implementation files

- `web/src/App.tsx` — extend `View` type to carry `isNew?: boolean` on the `note` variant; set it in `handleNewNote`
- `web/src/components/NoteView.tsx` — add `isNew?: boolean` prop; call `onDelete(noteId)` instead of `onBack()` when `isNew` is true

---

### Acceptance criteria

- [x] Clicking Cancel on a brand-new blank note (no title, content, tags, or actions) deletes it and returns to the list — no dialog
- [x] Clicking Cancel → Confirm Discard on a brand-new note (any content state) deletes it and returns to the list
- [x] Canceling an existing note (not newly created) never deletes it — only navigates back
- [x] Tests cover all three scenarios

---

## Slice 11-D — Token expiry and silent refresh

**Status:** Done

**Value:** Google ID tokens expire after 1 hour. Without a refresh mechanism, users are silently logged out mid-session: API calls start returning 401s, the UI stops working, and there is no clear feedback. This slice makes expiry invisible when the browser allows silent refresh, and shows a clear re-sign-in prompt as the fallback when it cannot.

**Backend changes:** None. The API already validates token expiry via JWT Bearer middleware.

---

### How it works

Google ID tokens carry an `exp` claim. The flow:

1. On sign-in, schedule a silent refresh 5 minutes before the token's `exp` timestamp using `setTimeout`.
2. Silent refresh attempts `prompt=none` in a hidden iframe — this reuses the existing Google session without user interaction. On success, swap in the new token transparently and reschedule.
3. If silent refresh fails (third-party cookies blocked, session ended, consent required), cancel the timer and show the re-sign-in banner.
4. As a safety net, the existing 401 handler in `api.ts` also triggers the re-sign-in banner — this covers any token that expired before the timer fired (e.g., tab left open overnight, clock skew).

The re-sign-in banner is a non-dismissable overlay/banner that blocks interaction and shows a single "Sign in again" button initiating a fresh PKCE flow.

---

### Key implementation files

- `web/src/auth/useGoogleAuth.ts` — add `scheduleRefresh(exp: number)`: parses the `exp` claim from the decoded ID token, sets a `setTimeout` for `(exp - now - 5min)`, attempts silent refresh via hidden iframe on fire; on failure calls `handleAuthFailure()`
- `web/src/auth/AuthContext.tsx` — expose `sessionExpired: boolean`; set it when silent refresh fails or a 401 is received; cleared on successful re-sign-in
- `web/src/api.ts` — existing 401 handler sets `sessionExpired` via context rather than clearing the token silently; ensures the banner is shown
- `web/src/components/SessionExpiredBanner.tsx` — new component: full-screen overlay shown when `sessionExpired` is true; "Sign in again" button triggers `signIn()`

---

### Scenarios

```
Scenario: Token refreshed silently before expiry
  Given I am signed in with a token expiring in 65 minutes
  When  55 minutes have elapsed
  Then  a silent refresh attempt is made in the background
  And   my session continues uninterrupted with a new token

Scenario: Silent refresh succeeds — no user-visible interruption
  Given a silent refresh attempt is made
  When  the iframe returns a new ID token
  Then  the new token replaces the old one in memory
  And   a new refresh is scheduled based on the new token's expiry
  And   the re-sign-in banner is not shown

Scenario: Silent refresh fails — re-sign-in banner shown
  Given a silent refresh attempt is made
  When  the iframe returns an error (e.g. third-party cookies blocked)
  Then  the re-sign-in banner is shown
  And   all API calls are blocked until the user signs in again

Scenario: 401 response triggers re-sign-in banner
  Given I am signed in
  When  any API call returns 401
  Then  the re-sign-in banner is shown immediately
  And   the expired token is cleared from memory

Scenario: Signing in again clears the banner
  Given the re-sign-in banner is visible
  When  I click "Sign in again" and complete the PKCE flow
  Then  the banner is dismissed
  And   my session resumes normally

Scenario: Token scheduled for refresh on sign-in
  Given I complete the sign-in PKCE flow
  When  the ID token is stored in memory
  Then  a refresh timer is scheduled for 5 minutes before the token's exp claim
```

---

### Acceptance criteria

- [x] A refresh timer is scheduled on every successful sign-in (initial and after silent refresh), set to fire 5 minutes before the token's `exp`
- [x] Silent refresh via hidden iframe is attempted when the timer fires; on success the token is replaced and the timer rescheduled — no user interruption
- [x] When silent refresh fails, `sessionExpired` is set to `true` and the re-sign-in banner is shown
- [x] Any 401 response from the API sets `sessionExpired` and shows the banner, regardless of the timer
- [x] The banner is non-dismissable; the only exit is completing a fresh sign-in
- [x] Completing sign-in from the banner clears `sessionExpired` and resumes the session
- [x] The refresh timer is cleared on sign-out
- [x] Component tests cover: timer scheduling on sign-in, silent refresh success path, silent refresh failure path, 401 triggering banner, re-sign-in from banner

---
