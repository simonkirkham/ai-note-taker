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
11-E  Delete note from home screen ──────────────────────────── independent
11-F  Adaptive note action buttons ──────────────────────────── independent
11-G  Fix 401s during active sessions ─────────────────────── bug fix (builds on 11-D)
11-H  Fix note not deleted when discarded from meeting ──────── bug fix (builds on 11-C)
```

---

## Slice 11-A — Tag autocomplete and suggestions

**Status:** Done

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

- [x] Typing in the tag input shows a ranked dropdown (prefix matches above substring matches, each group sorted by `noteCount` desc)
- [x] Tab on an open dropdown completes the input with the top (or highlighted) suggestion; pressing Tab again submits it
- [x] `↑` / `↓` navigate the dropdown; highlighted item wraps at top/bottom
- [x] Enter submits the highlighted suggestion (or the raw input if nothing is highlighted)
- [x] Escape closes the dropdown without submitting
- [x] Clicking a suggestion submits it
- [x] Empty focus state shows Common (top 8 by count) and Related (top 5 by co-occurrence, only when note has tags)
- [x] Already-applied tags never appear in suggestions
- [x] `useTagSuggestions` is a pure function of `(input, allTags, appliedTags)` — no side effects, testable in isolation
- [x] All existing `TagsSection` component tests remain green
- [x] New component tests cover: prefix ranking, substring ranking, Tab completion, keyboard nav, Related algorithm, exclusion of applied tags

---

## Slice 11-B — Add To Do from the home screen

**Status:** Done

**Value:** Users can capture a to-do item without navigating away from the home screen. Standalone to-dos are independent of notes — no hidden note, no filtering hack. The To Do section gains a quick-add input, reopen and delete affordances on all items, and a collapsible "Done" section showing what was completed today.

**Backend changes:** New `Todo` aggregate with `TodoAdded` / `TodoCompleted` / `TodoReopened` / `TodoDeleted` events. New `POST /todos`, `POST /todos/{todoId}/complete`, `POST /todos/{todoId}/reopen`, `DELETE /todos/{todoId}` endpoints. Projection updated to retain completed items and unify note-based actions and standalone todos under a single response shape.

---

### Domain — `Todo` aggregate

Stream key: `todo-{todoId}`

**Events:**

| Event | Fields |
|-------|--------|
| `TodoAdded` | `TodoId`, `UserId`, `Description`, `Priority?` |
| `TodoCompleted` | `TodoId` |
| `TodoReopened` | `TodoId` |
| `TodoDeleted` | `TodoId` |

`Priority` is nullable and reserved for a future prioritisation UI (today / next / later). It is accepted on `POST /todos` but ignored by the frontend in this slice.

**Commands:** `AddTodo`, `CompleteTodo`, `ReopenTodo`, `DeleteTodo`

---

### New API endpoints

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `POST` | `/todos` | `{ description, priority? }` | Creates standalone to-do |
| `POST` | `/todos/{todoId}/complete` | — | |
| `POST` | `/todos/{todoId}/reopen` | — | |
| `DELETE` | `/todos/{todoId}` | — | |

---

### Projection changes

`TodoItem` record in `EventStore.Projections`:

| Field | Type | Notes |
|-------|------|-------|
| `ItemId` | `string` | `ActionId.Value` or `TodoId.Value` — no domain typing in the read model |
| `NoteId` | `string?` | Null for standalone todos |
| `NoteTitle` | `string?` | Null for standalone todos |
| `Type` | `string` | `"action"` or `"todo"` |
| `Description` | `string` | |
| `AddedAt` | `DateTimeOffset` | |
| `CompletedAt` | `DateTimeOffset?` | Null = open |
| `UserId` | `string` | |

**Behaviour changes:**
- `ActionCompleted` now **updates** `CompletedAt` on the projection record instead of deleting it
- `ActionReopened` clears `CompletedAt`
- `TodoCompleted` / `TodoReopened` / `TodoDeleted` handled by the same `TodoListEventHandler`
- `ITodoListStore.DeleteAsync` signature changes from `(ActionId, ct)` to `(string itemId, ct)`

**`GET /todos` response:**
- Returns open items (no `CompletedAt`) **plus** items where `CompletedAt` falls within today's local calendar day (determined server-side from the `Date` header or UTC date; frontend already knows local date)
- Response shape adds `type`, `itemId`, `noteId?`, `noteTitle?`, `completedAt?`

---

### UX design

The To Do panel on the home screen (`TodoSection.tsx`) gains:

1. **Quick-add input** — single-line "Add a to-do…" always visible at the top. Enter or clicking Add submits; empty input is a no-op.
2. **Reopen and delete affordances** on every open item (matching the existing `ActionsSection` in note view).
3. **"Done" section** — collapsible, collapsed by default, toggle label shows count (e.g. "Done (3)"). Contains items completed today (local calendar day). Both note-based actions and standalone todos appear here. Each done item has a reopen and a delete affordance.

**Optimistic UI — all interactions:**
- Add: item appears at top of open list immediately with a temporary client-side `itemId`; replaced with real `itemId` on success; removed and inline error shown on failure
- Complete: item moves from open list to Done section immediately; rolls back on failure
- Reopen: item moves from Done section to top of open list immediately; rolls back on failure
- Delete: item removed from whichever list it was in immediately; rolls back on failure

**Note title display:** Standalone to-dos show no secondary line. Note-based items still show `noteTitle`.

---

### Key implementation files

**Backend (new):**
- `src/Domain/Todos/` — `Todo` aggregate, `TodoId`, all events and commands
- `src/Api/CommandHandlers/TodoCommandHandler.cs`
- `src/Api/Handlers/TodoHandlers.cs` — new handlers for the four endpoints
- `src/Api/Endpoints/TodoEndpoints.cs` — wire up new routes
- `tests/Domain.Specs/Todos/` — BDD specs for all four commands

**Backend (modified):**
- `src/EventStore/Projections/TodoItem.cs` — updated record shape
- `src/EventStore/Projections/ITodoListStore.cs` — updated interface
- `src/EventStore/Projections/DynamoDbTodoListStore.cs` — updated implementation
- `src/Api/CommandHandlers/ActionItemCommandHandler.cs` — `ActionCompleted` → update, not delete
- `src/Api/Projections/TodoListEventHandler.cs` — handle new `Todo` events
- `src/Api/Handlers/TodoHandlers.cs` — `GET /todos` updated response shape

**Frontend (new):**
- `web/src/components/QuickCaptureTodoInput.tsx` — input + submit; optimistic add

**Frontend (modified):**
- `web/src/components/TodoSection.tsx` — add `QuickCaptureTodoInput`, reopen/delete affordances, Done section
- `web/src/api.ts` — updated `TodoItem` type; new `addTodo`, `completeTodo`, `reopenTodo`, `deleteTodo` functions

---

### Scenarios

```
Scenario: Add a standalone to-do from the home screen
  Given I am on the home screen
  When  I type "Buy milk" in the to-do input and press Enter
  Then  "Buy milk" appears at the top of the open list immediately
  And   the input clears and is ready for the next item
  And   no note is created

Scenario: Optimistic item replaced with real item on success
  Given I have submitted "Buy milk" from the home screen
  When  the API responds successfully
  Then  "Buy milk" remains in the list with its server-assigned ID

Scenario: Optimistic item removed on API failure
  Given I have submitted "Buy milk" from the home screen
  When  the API call fails
  Then  "Buy milk" is removed from the list
  And   an error message is shown beneath the input

Scenario: Empty input is not submitted
  Given the to-do input is empty
  When  I press Enter or click Add
  Then  nothing is submitted and no error is shown

Scenario: Completing an item moves it to the Done section
  Given "Buy milk" is in the open list
  When  I mark it complete
  Then  "Buy milk" moves to the Done section immediately
  And   the Done section toggle shows the updated count

Scenario: Done section is collapsed by default
  Given items were completed today
  When  I view the To Do panel
  Then  the Done section is collapsed and shows "Done (N)"

Scenario: Reopening an item moves it back to the open list
  Given "Buy milk" is in the Done section
  When  I click Reopen on it
  Then  "Buy milk" moves to the top of the open list immediately

Scenario: Deleting an open item removes it
  Given "Call dentist" is in the open list
  When  I click Delete on it
  Then  "Call dentist" is removed from the list immediately

Scenario: Deleting a done item removes it
  Given "Buy milk" is in the Done section
  When  I click Delete on it
  Then  "Buy milk" is removed from the Done section immediately

Scenario: Deleting a note-based action from TodoSection removes it from the note too
  Given a note-based action "Review slides" is in the open list
  When  I click Delete on it
  Then  "Review slides" is removed from TodoSection
  And   the action is deleted from its note aggregate

Scenario: Completed item rolls back on failure
  Given "Buy milk" is in the open list
  When  I mark it complete and the API call fails
  Then  "Buy milk" returns to the open list
  And   an error message is shown

Scenario: Standalone to-do shows no note title
  Given a standalone to-do "Buy milk" and a note-based action "Review slides" are in the open list
  Then  "Buy milk" has no secondary line
  And   "Review slides" shows its note title

Scenario: Done section only shows items completed today
  Given an item was completed yesterday
  When  I view the Done section
  Then  the yesterday item does not appear
```

---

### Acceptance criteria

- [x] An "Add a to-do…" input is always visible at the top of the To Do panel
- [x] Pressing Enter or clicking Add submits; empty input is a no-op
- [x] Standalone to-dos are created via `POST /todos` — no note is involved
- [x] New item appears at top of open list immediately; temporary ID replaced with real ID on success; item removed and error shown on failure
- [x] Every open item has reopen (no-op if already open) and delete affordances
- [x] Completing an item moves it to the Done section optimistically; rolls back on failure
- [x] Reopening a done item moves it back to the open list optimistically; rolls back on failure
- [x] Deleting from either list removes it optimistically; rolls back on failure
- [x] Deleting a note-based action calls `DELETE /notes/{noteId}/actions/{actionId}`
- [x] Done section is collapsed by default; toggle shows count; expands on click
- [x] Done section shows only items completed today (local calendar day); nothing from previous days
- [x] Standalone to-dos show no note title; note-based items still show `noteTitle`
- [x] `TodoItem` projection record uses `string ItemId`, `string? NoteId`, `string? NoteTitle`, `string Type`, `DateTimeOffset? CompletedAt`
- [x] `ActionCompleted` updates `CompletedAt` in the projection instead of deleting the record
- [x] BDD specs cover all four `Todo` aggregate commands
- [x] Component tests cover: submit on Enter, submit on click, empty-input no-op, optimistic add, rollback on add failure, complete moves to Done, reopen moves to open, delete from open list, delete from Done, rollback on complete/reopen/delete failure, Done section collapsed by default, today-only filter

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

## Slice 11-E — Delete note from home screen

**Status:** Done

**Value:** Users can remove unwanted notes without first navigating into them. A delete affordance on each note card in the home screen list triggers a confirmation prompt, then removes the note immediately with optimistic UI.

**Backend changes:** None. `DELETE /notes/{noteId}` already exists.

---

### UX design

Each note card in `MeetingsSection` gains a delete icon button (visible on hover or always visible on touch devices). Clicking it opens a small inline confirmation ("Delete this note?") with Confirm and Cancel. On confirm:

- The note card is removed from the list immediately (optimistic).
- `DELETE /notes/{noteId}` is called in the background.
- On API failure, the note reappears at its original position and a brief error message is shown.

---

### Key implementation files

- `web/src/components/MeetingsSection.tsx` — add delete icon + inline confirmation per note card; call `onDeleteNote(noteId)` on confirm
- `web/src/App.tsx` — implement `handleDeleteNote(noteId)`: optimistically remove from state, call `deleteNote(noteId)`, restore on failure

---

### Scenarios

```
Scenario: Delete icon is visible on each note card
  Given I am on the home screen with at least one note
  Then  each note card shows a delete affordance

Scenario: Clicking delete asks for confirmation
  Given I am on the home screen
  When  I click the delete icon on a note card
  Then  a confirmation prompt appears on that card
  And   the note is not yet removed

Scenario: Confirming deletes the note optimistically
  Given the confirmation prompt is showing for "Team sync"
  When  I confirm the deletion
  Then  "Team sync" is removed from the list immediately
  And   DELETE /notes/{noteId} is called

Scenario: Cancelling dismisses the prompt without deleting
  Given the confirmation prompt is showing for "Team sync"
  When  I click Cancel
  Then  the prompt closes
  And   "Team sync" remains in the list

Scenario: Note restored on API failure
  Given I confirmed deletion of "Team sync"
  When  the API call fails
  Then  "Team sync" reappears in the list
  And   an error message is shown

Scenario: Deleting a note while viewing another note is unaffected
  Given "Team sync" has been deleted from the home screen
  When  I navigate to a different note
  Then  "Team sync" does not appear when I return to the home screen
```

---

### Acceptance criteria

- [x] Each note card on the home screen shows a delete affordance
- [x] Clicking the affordance shows an inline confirmation; the note is not removed until confirmed
- [x] On confirmation, the note disappears from the list immediately (optimistic)
- [x] `DELETE /notes/{noteId}` is called after optimistic removal
- [ ] On API failure, the note is restored at its original list position and an error message is shown
- [x] Cancelling the confirmation closes the prompt and leaves the note in place
- [x] Component tests cover: delete icon render, confirm removes note, cancel leaves note, rollback on failure

---

## Slice 11-F — Adaptive note action buttons

**Status:** Done

**Value:** The note view's action bar adapts to what the user has actually done, removing the ambiguous Cancel-vs-Save choice. A blank new note shows only Cancel (quick escape hatch). Once any content exists — title, body, tags, actions, todos, or transcript — Cancel disappears and Save + Delete take over as the only exits.

**Backend changes:** None.

---

### Behaviour

| State | Visible buttons |
|-------|----------------|
| Note has no content (blank) | Cancel only |
| Note has any content | Save + Delete (no Cancel) |

"Has content" mirrors the existing `isSaveEnabled` check: `title`, `content`, `tags`, or `actionCount > 0`, plus `transcriptText !== null`. The check is live — switching from blank to non-blank (or vice versa) updates the button set immediately.

**Cancel** (blank note only) — deletes the note and returns to the home screen, consistent with 11-C behaviour.

**Save** — persists the current state and returns to the home screen.

**Delete** — deletes the note and returns to the home screen. No secondary confirmation dialog; the action is immediately reversible by recreating the note, and the user has explicitly navigated to and decided to remove it.

The existing "Discard this note?" dialog (`showCancelDialog`) is removed; it is no longer reachable.

---

### Key implementation files

- `web/src/components/NoteView.tsx` — derive `hasContent` from existing state; conditionally render `Cancel` vs `Save + Delete`; remove `showCancelDialog` state and dialog markup

---

### Scenarios

```
Scenario: Blank new note shows only Cancel
  Given I have just created a new note and entered nothing
  Then  only the Cancel button is visible
  And   Save and Delete are not shown

Scenario: Adding a title reveals Save and Delete
  Given a blank new note showing only Cancel
  When  I type a title
  Then  Save and Delete appear
  And   Cancel is no longer shown

Scenario: Adding content reveals Save and Delete
  Given a blank new note showing only Cancel
  When  I type body content
  Then  Save and Delete appear
  And   Cancel is no longer shown

Scenario: Cancel on a blank note deletes it
  Given a blank new note showing only Cancel
  When  I click Cancel
  Then  the note is deleted
  And   I return to the home screen

Scenario: Save on a note with content saves and returns
  Given a note with a title "Team sync"
  When  I click Save
  Then  the note is saved
  And   I return to the home screen

Scenario: Delete on a note with content deletes and returns
  Given a note with a title "Team sync"
  When  I click Delete
  Then  the note is deleted
  And   I return to the home screen

Scenario: Existing note always shows Save and Delete
  Given I open an existing note from the home screen
  Then  Save and Delete are visible immediately
  And   Cancel is not shown
```

---

### Acceptance criteria

- [ ] A blank note (no title, content, tags, actions, or transcript) shows only Cancel
- [ ] Once any content is present, Save and Delete are shown and Cancel is hidden
- [ ] The button set updates live as the user types or adds/removes content
- [ ] Cancel on a blank note deletes it and navigates home (11-C behaviour preserved)
- [ ] Save navigates home (saving current state)
- [ ] Delete deletes the note and navigates home without a confirmation dialog
- [ ] The `showCancelDialog` state and dialog markup are removed
- [ ] Existing notes opened from the home screen always show Save + Delete on first render
- [ ] Component tests cover: blank-note button set, content-added transition, Cancel deletes blank, Save navigates, Delete deletes, existing note initial render

---

## Slice 11-G — Fix 401s during active sessions

**Status:** Done

**Bug:** Users receive 401 errors mid-session despite the silent-refresh mechanism implemented in 11-D. The root cause is two compounding issues:

1. **Browser timer throttling.** Browsers aggressively throttle `setTimeout` in background tabs (delays can stretch from minutes to hours). A 5-minute refresh lead time is insufficient if the tab is backgrounded — the timer fires late, the token has already expired, and the next API call returns 401.
2. **Iframe silent refresh blocked.** The `prompt=none` iframe flow in `silentRefresh.ts` relies on third-party cookies to reuse the Google session. Modern browsers (Chrome with Privacy Sandbox, Safari ITP) block this, causing `attemptSilentRefresh` to always return `null` after its 15-second timeout. The resulting `onRefreshFailure` shows the session-expired banner rather than transparently renewing the token.

**Backend changes:** None.

---

### Fix

Two independent improvements, both needed:

**1 — Recheck on tab visibility change.**
Add a `visibilitychange` listener in `AuthContext`. When the document becomes visible (`document.visibilityState === 'visible'`), decode the current token's `exp`. If the token is already expired, call `onRefreshFailure` immediately (show the banner) rather than letting the next API call hit a 401. If the token is within `REFRESH_LEAD_MS` of expiry, attempt a silent refresh immediately rather than waiting for the throttled timer.

**2 — Proactive expiry guard in the API layer.**
In `api.ts`, before attaching the `Authorization` header, check whether the token is expired (`exp * 1000 < Date.now()`). If it is, call `triggerUnauthorized()` immediately and abort the fetch rather than sending a request that will 401. This ensures the banner appears instantly on tab wake-up rather than after a round-trip to the API.

---

### Key implementation files

- `web/src/auth/AuthContext.tsx` — add `visibilitychange` listener; on visibility, check expiry and either trigger failure or immediate refresh
- `web/src/api.ts` — add pre-flight expiry check before `fetch`; call `triggerUnauthorized()` and short-circuit if token is expired

---

### Scenarios

```
Scenario: Tab wakes with an expired token — no API call is made
  Given I have a token that expired while the tab was backgrounded
  When  I switch back to the tab
  Then  the session-expired banner appears immediately
  And   no API calls are attempted with the expired token

Scenario: Tab wakes with a token near expiry — refresh attempted immediately
  Given I have a token expiring in less than 5 minutes
  When  I switch back to the tab
  Then  a silent refresh is attempted immediately
  And   if it succeeds, my session continues uninterrupted

Scenario: API call attempted with expired token — short-circuited
  Given the token has expired (regardless of how)
  When  any API call is made
  Then  the fetch is not sent
  And   the session-expired banner appears immediately

Scenario: Token valid on tab wake — no action taken
  Given I have a token with more than 5 minutes remaining
  When  I switch back to the tab
  Then  no refresh is triggered and the app continues normally
```

---

### Acceptance criteria

- [x] A `visibilitychange` listener is registered in `AuthContext`; it is cleaned up on unmount
- [x] On tab becoming visible: if token is expired, `sessionExpired` is set immediately without waiting for an API call
- [x] On tab becoming visible: if token is within `REFRESH_LEAD_MS` of expiry, silent refresh is attempted immediately
- [x] In `api.ts`, a request with an expired token is short-circuited: fetch is not called, `triggerUnauthorized()` fires
- [x] Tests cover: tab wake with expired token, tab wake with near-expiry token, tab wake with valid token, API call with expired token

---

## Slice 11-H — Fix note not deleted when discarded from meeting creation

**Status:** Done

**Bug:** When the user clicks "Create note" on a meeting card in `MeetingsSection`, the note is created on the backend immediately and the user is navigated to `NoteView`. If they then click Cancel (without adding any content), the note is not deleted — it persists in the notes list.

**Root cause:** `MeetingsSection.handleCreateNote` calls `onOpenNote(noteId, meeting.title)`, which in `App.tsx` calls `setView({ kind: "note", noteId, initialTitle: title })` without setting `isNew: true`. `NoteView` therefore treats the note as an existing note: Cancel triggers `onBack()` rather than `onDelete(noteId)`.

**Backend changes:** None.

---

### Fix

Pass `isNew: true` when navigating to a note that was just created from a meeting. The simplest change is in `App.tsx`: update the `onOpenNote` lambda passed to `MeetingsSection` to accept an `isNew` flag, and set it in the view state.

`MeetingsSection` already calls `onOpenNote(noteId, meeting.title)` after `createNoteFromMeeting` and `onOpenNote(noteId)` after `createNoteFromNextOccurrence` — both navigate to a freshly-created note and should mark it as new.

With `isNew: true` set, the existing 11-C behaviour applies: Cancel on a blank note deletes it; Cancel on a note with content shows the "Discard this note?" dialog which, on confirm, deletes the note and returns to the home screen.

---

### Key implementation files

- `web/src/App.tsx` — update `onOpenNote` passed to `MeetingsSection` to set `isNew: true` in the view state
- `web/src/components/MeetingsSection.tsx` — no change required if `App.tsx` handles `isNew`; alternatively, `onOpenNote` signature can accept an optional `isNew` boolean if preferred

---

### Scenarios

```
Scenario: Cancelling a blank note created from a meeting deletes it
  Given I click Create Note on a meeting card
  And   I have not entered any content
  When  I click Cancel
  Then  the note is deleted
  And   I return to the home screen
  And   the meeting card no longer shows a linked note

Scenario: Cancelling a note with content created from a meeting shows discard dialog
  Given I click Create Note on a meeting card
  And   I have typed a title
  When  I click Cancel
  Then  the "Discard this note?" dialog appears

Scenario: Confirming discard on a meeting note deletes it
  Given the discard dialog is showing for a meeting-created note
  When  I confirm discard
  Then  the note is deleted
  And   I return to the home screen

Scenario: Saving a note created from a meeting keeps it
  Given I click Create Note on a meeting card and add a title
  When  I click Save
  Then  the note is saved and I return to the home screen
  And   the meeting card shows the linked note

Scenario: Same fix applies to next-occurrence note creation
  Given I click Create Note for the next occurrence of a recurring meeting
  And   I have not entered any content
  When  I click Cancel
  Then  the note is deleted
  And   I return to the home screen
```

---

### Acceptance criteria

- [x] Clicking Cancel on a blank note navigated to from a meeting card deletes the note
- [x] Clicking Cancel → Confirm Discard on a non-blank meeting-created note deletes the note *(note: the discard dialog was removed in 11-F; non-blank meeting-created notes now show Delete instead)*
- [x] Clicking Save on a meeting-created note keeps the note and returns to the home screen
- [x] The fix applies to both `createNoteFromMeeting` and `createNoteFromNextOccurrence` paths
- [x] The meeting card reverts its "linked note" state when the note is deleted via Cancel
- [x] Component tests cover: blank cancel deletes, non-blank cancel shows dialog, confirm discard deletes, save keeps note, next-occurrence path

---
