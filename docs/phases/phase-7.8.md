# Phase 7.8 — Production Pipeline and Note Screen UX

**Goal:** Establish a production deployment target and sharpen the note-screen interaction model with explicit lifecycle controls, keyboard-first focus, drag-and-drop note filing, and a layout that uses available screen space effectively.

**Learning surface:** Multi-environment GitHub Actions pipeline with environment-scoped secrets and sequential promotion; React controlled form patterns and dirty-state detection across multiple fields; focus management with `useRef` and `tabIndex`; HTML5 drag-and-drop API in React; `useReducer` as a client-side projection — discriminated union action types as frontend events, pure reducer as state machine, compensating actions as reverts; responsive CSS layout with fluid containers and viewport-aware sizing.

---

## Slice order and dependencies

```
7.8-A  Production pipeline ──────────────────── CI/CD only (manual AWS + GitHub setup)
7.8-B  Note screen focus ────────────────────── frontend only; independent
7.8-C  Note screen save/cancel ──────────────── frontend only; independent of 7.8-B
7.8-D  Drag-and-drop into folder panel ─────── frontend only; independent
7.8-E  Layout space review ──────────────────── frontend only; prototype recommended
7.8-F  Optimistic card state sync ───────────── frontend only; independent
7.8-G  Domain event dispatcher ──────────────── backend refactor; independent
7.8-H  Human-readable URLs ─────────────────── CDK + CI; depends on 7.8-A (prod env exists)
```

All slices are independent and can run in any order. 7.8-B and 7.8-C both touch `NoteView.tsx` so should not run in parallel.

---

## Slice 7.8-A — Production deployment pipeline

**Status:** In Progress (smoke tests pending first successful deploy)

**Value:** Every merge to main automatically promotes through Test and then deploys to a production environment, giving confidence that what works in Test ships to users.

**Manual setup steps (not a code slice — done by the developer):**
1. Create a production AWS account via AWS Organizations.
   - New member accounts have **password recovery disabled** — do not try to reset the root password via the standard flow.
   - Access the new account via Switch Role: add an inline `sts:AssumeRole` policy on your management account IAM user (resource: `arn:aws:iam::<NEW_ACCOUNT_ID>:role/OrganizationAccountAccessRole`), then use `https://signin.aws.amazon.com/switchrole` with role `OrganizationAccountAccessRole`.
2. In the production account, create a `github-deploy` IAM user with `AdministratorAccess` and generate an access key.
3. Bootstrap CDK in the production account (one-time per account/region): `AWS_ACCESS_KEY_ID=<key> AWS_SECRET_ACCESS_KEY=<secret> AWS_REGION=<region> cdk bootstrap`
4. In GitHub repo Settings → Environments → New environment: name it `Production`.
5. Add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` as environment secrets for `Production`.
6. Optionally add a required reviewer to the `Production` environment for a manual approval gate before production deploys.

**Scenarios:**

```
Scenario: A merge to main promotes through Test then deploys to Production
  Given the Test deploy succeeds
  When  the deploy workflow runs on main
  Then  the deploy-production job runs after the deploy job completes
  And   the Production environment receives the same CDK stack

Scenario: A Test deploy failure blocks production
  Given the Test deploy fails
  When  the deploy workflow runs on main
  Then  the deploy-production job does not start

Scenario: Smoke tests pass against the production API
  Given production has been deployed
  When  the deploy-production job runs acceptance specs
  Then  all Api.Smoke tests pass against the production API URL
```

**Acceptance criteria:**

- [x] `Production` GitHub environment exists with `AWS_*` secrets configured
- [x] `deploy-production` job runs after `deploy` (Test) succeeds
- [x] `deploy-production` job does not run when `deploy` fails
- [ ] Acceptance specs pass against the production API URL post-deploy
- [x] No E2E tests run against production

---

## Slice 7.8-B — Note screen keyboard focus

**Status:** Done

**Value:** Opening a note is keyboard-ready immediately — the cursor is in the title so I can start typing or rename without clicking. A single Tab moves focus to the content area so I can write without reaching for the mouse.

**What is already in place:**
- `NoteView.tsx` already calls `inputRef.current?.focus()` after the detail load resolves — cursor-in-title may already work
- The title is an `<input>` and the content is a `<textarea>` or editor element

**What needs verifying / changing:**
- Confirm `inputRef` is attached to the title `<input>` (not the date or another input)
- Confirm that Tab from the title input moves focus to the content area and not to an intervening control (date picker, etc.)
- If intervening controls interrupt the Tab flow, use `tabIndex` ordering to enforce `title → content`
- All other controls (date, tags, action input) remain in natural tab order after content

**Changes in scope:**
- `web/src/components/NoteView.tsx` — verify `inputRef` on title; add `tabIndex` if needed to ensure title → content tab order
- `web/src/__tests__/NoteView.test.tsx` — add: "title input is focused on load"; "pressing Tab from title moves focus to content"

**Scenarios:**

```
Scenario: Title input receives focus when the note screen opens
  Given I navigate to a note
  When  the note detail has loaded
  Then  the title input has focus

Scenario: Tab from title moves focus to the content area
  Given the note screen is open and the title input has focus
  When  I press Tab once
  Then  the content area has focus

Scenario: Tab order skips to content directly from title
  Given the note screen has a date input between the title and content
  When  I press Tab once from the title input
  Then  focus moves to the content area, not the date input
```

**Acceptance criteria:**

- [x] Title input has focus immediately after note detail loads (no click needed)
- [x] Single Tab from title moves focus to content
- [x] Date input and other controls are still reachable via Tab after content
- [x] Component tests cover focus-on-load and Tab behaviour

---

## Slice 7.8-C — Note screen save/cancel

**Status:** Done

**Value:** New notes have an explicit lifecycle — Save confirms the note is worth keeping; Cancel abandons it cleanly. This prevents empty or accidental notes building up in the list, and gives users a clear escape hatch on a note they didn't mean to create.

**Interaction model:**

- Save and Cancel buttons are always visible on the note screen.
- **Save** is disabled when the note has no title, no content, no tags, and no actions.
- **Save** is enabled as soon as any of those fields is non-empty.
- Clicking **Save** navigates back to the note list (content is already auto-persisted on blur — Save is a "done" action).
- Clicking **Cancel** on a note with no title, content, tags, or actions navigates back immediately (no confirmation — nothing to lose).
- Clicking **Cancel** on a note with any content shows a confirmation dialog: "Discard this note?" with Confirm and Keep Editing options. Confirm navigates back.

**Note:** Auto-save on blur is preserved for content and title. Save/Cancel are navigation controls, not persistence controls. The note is already saved to the server as the user types; Save/Cancel determine whether to stay on the screen or leave.

**Changes in scope:**

- `web/src/components/NoteView.tsx` — add `isSaveEnabled` derived state (true if title, content, tags, or actions are non-empty); add Save and Cancel buttons; wire Cancel confirmation dialog; Save navigates via `onBack()`
- `web/src/components/NoteView.tsx` — track action count to include in `isSaveEnabled`; `ActionsSection` must surface action count to parent (or NoteView reads it from loaded detail)
- `web/src/__tests__/NoteView.test.tsx` — tests for all scenarios below

**Scenarios:**

```
Scenario: Save is disabled on an empty new note
  Given a note with no title, no content, no tags, and no actions
  When  the note screen renders
  Then  the Save button is disabled

Scenario: Save enables when a title is entered
  Given a note with no content, no tags, and no actions
  When  I type a title
  Then  the Save button is enabled

Scenario: Save enables when content is entered
  Given a note with no title, no tags, and no actions
  When  I type content
  Then  the Save button is enabled

Scenario: Save enables when a tag is added
  Given a note with no title, no content, and no actions
  When  I add a tag
  Then  the Save button is enabled

Scenario: Save enables when an action is added
  Given a note with no title, no content, and no tags
  When  I add an action item
  Then  the Save button is enabled

Scenario: Save navigates back to the note list
  Given the Save button is enabled
  When  I click Save
  Then  I am taken back to the note list

Scenario: Cancel on an empty note navigates back immediately
  Given a note with no title, no content, no tags, and no actions
  When  I click Cancel
  Then  I am taken back to the note list without a confirmation dialog

Scenario: Cancel on a note with content shows a confirmation dialog
  Given a note with a title entered
  When  I click Cancel
  Then  a confirmation dialog appears asking "Discard this note?"

Scenario: Confirming cancel navigates back
  Given the cancel confirmation dialog is showing
  When  I click Confirm
  Then  I am taken back to the note list

Scenario: Keeping editing dismisses the dialog
  Given the cancel confirmation dialog is showing
  When  I click Keep Editing
  Then  the dialog closes and I remain on the note screen
```

**Acceptance criteria:**

- [x] Save disabled when title, content, tags, and actions are all empty
- [x] Save enabled when any of title, content, tags, or actions is non-empty
- [x] Save navigates back via `onBack()`
- [x] Cancel on empty note navigates back without confirmation
- [x] Cancel on non-empty note shows confirmation dialog
- [x] Confirming cancel navigates back; "Keep Editing" dismisses dialog
- [x] Component tests cover all scenarios above

---

## Slice 7.8-D — Drag-and-drop notes into folder slide-out panel

**Status:** Done

**Value:** I can file a note into a folder by dragging the note card from the home screen and dropping it onto the folder's slide-out preview panel, without needing to navigate into the note screen to change its folder.

**What is already in place:**
- Folders have a `»` button that opens a `FolderPreviewPanel` slide-out showing the folder's notes
- `MoveNoteToFolder` command exists in the domain (`src/Domain/Notes/MoveNoteToFolder.cs`)
- `POST /notes/{noteId}/move` endpoint exists (or will be confirmed before implementation)
- Note cards (`NoteCard.tsx`) render on the home screen

**Interaction design:**
- Note cards are draggable (`draggable` attribute + `onDragStart`)
- The `FolderPreviewPanel` accepts drops (`onDragOver` + `onDrop`)
- On drop: call `POST /notes/{noteId}/move` with the target folder ID; optimistically remove the note card from the Unfiled / current folder view and add it to the folder panel's note list
- If the API call fails: revert the optimistic update and show an error
- A note already in the target folder: drop is a no-op (no API call)
- Dragging a note to the same folder it is already in: visual feedback that it's the current folder; drop does nothing

**Changes in scope:**

- `web/src/components/NoteCard.tsx` — add `draggable` attribute; `onDragStart` stores `noteId` in `dataTransfer`
- `web/src/components/FolderPreviewPanel.tsx` — add `onDragOver` (prevent default to allow drop); `onDrop` reads `noteId` from `dataTransfer`; calls move API; triggers optimistic state update
- `web/src/api.ts` — add `moveNoteToFolder(noteId, folderId)` → `POST /notes/{noteId}/move`
- `web/src/App.tsx` (or wherever folder/card state lives) — handle optimistic removal from current list and add to folder
- `web/src/__tests__/NoteCard.test.tsx` — add: "note card is draggable"; "dragStart sets noteId in dataTransfer"
- `web/src/__tests__/FolderPreviewPanel.test.tsx` — add: "drop calls moveNoteToFolder"; "optimistic update moves card"; "failed move reverts"

**Scenarios:**

```
Scenario: Dragging a note card onto a folder panel moves the note
  Given a note card is shown on the home screen
  And   a folder's slide-out panel is open
  When  I drag the note card and drop it onto the panel
  Then  a move request is sent for that note and folder
  And   the note card disappears from its current view immediately (optimistic)
  And   the note appears in the folder panel

Scenario: A failed move reverts the optimistic update
  Given I dragged a note card onto a folder panel
  When  the move API call fails
  Then  the note card reappears in its original position
  And   the note is removed from the folder panel

Scenario: Dropping a note onto the folder it already belongs to does nothing
  Given a note is already in folder A
  And   folder A's panel is open
  When  I drop the note card onto folder A's panel
  Then  no API call is made

Scenario: Drop target folder panel shows a visual drop zone
  Given a note card is being dragged
  When  the card is dragged over an open folder panel
  Then  the panel shows a visual drop zone indicator
```

**Acceptance criteria:**

- [x] Note cards have `draggable` attribute set; `dragStart` writes `noteId` to `dataTransfer`
- [x] `FolderPreviewPanel` accepts drops; calls `moveNoteToFolder` on drop
- [x] Optimistic update: note disappears from source view and appears in panel immediately
- [x] Failed move reverts the optimistic update
- [x] Dropping onto the note's current folder is a no-op
- [x] Drop zone visual indicator shown during drag-over
- [x] Component tests cover drag, drop, optimistic update, and revert

---

## Slice 7.8-E — Layout space review

**Status:** Done

**Prototype recommended.** The right layout is uncertain enough that building a throwaway prototype before touching production CSS is the right call. Run the `prototype` skill first.

**Problem:** Both the home screen and note screen leave large blank margins on typical laptop and desktop viewports. The root causes identified from the CSS:

| Issue | Root cause |
|-------|-----------|
| Home screen constrained to a narrow column | `.container` has `max-width: 640px; margin: 0 auto` — on wide viewports this wastes the majority of the viewport width |
| Note content area feels small | `.note-layout` is `grid-template-columns: 1fr 320px` but the whole screen sits inside the narrow `.container`, so `1fr` resolves to a small absolute value |
| Right panel fixed at 320px | Fine on a 1280px+ screen; too wide relative to content on 900–1100px viewports |

**Design intent (to validate via prototype):**

- Home screen: note cards should expand to fill available width; consider a wider max-width (e.g. `1200px`) or removing the cap and using a responsive card grid instead of a single-column list
- Note screen: content panel should grow to fill the available viewport height and most of the horizontal space; right panel (actions/tags) should remain comfortably wide but not dominate
- Both screens should feel "full" on a 1280px laptop — no prominent blank gutters

**Changes in scope (post-prototype):**

- `web/src/App.css` — increase or remove `.container` max-width; adjust `.note-layout` column proportions; ensure `.content-input` `min-height` grows to fill available vertical space (e.g. use `flex-grow: 1` in a flex column rather than a fixed `60vh`)
- `web/src/__tests__/` — layout is visual; no new component tests required beyond confirming existing tests still pass after CSS changes

**Scenarios:**

```
Scenario: Home screen uses the full available width on a wide viewport
  Given the viewport is 1280px wide
  When  I view the home screen
  Then  note cards extend across the majority of the viewport
  And   there are no large blank margins on either side

Scenario: Note content panel fills available height
  Given I am on the note screen
  When  I look at the content editor
  Then  the editor extends to fill the available vertical space
  And   I do not need to scroll to find an empty area to type in

Scenario: Note right panel does not dominate the layout
  Given I am on the note screen on a 1280px viewport
  When  I look at the note layout
  Then  the content panel is visually larger than the right panel
  And   the right panel remains readable and usable

Scenario: Layout remains usable at 768px viewport width
  Given the viewport is 768px wide
  When  I view either screen
  Then  no content is cut off or inaccessible
```

**Acceptance criteria:**

- [ ] Prototype approved before CSS changes begin (skipped — interaction was unambiguous)
- [x] `.container` max-width increased or removed; home screen cards use available width
- [x] Note content panel grows to fill available vertical space (no fixed `min-height` that leaves blank space)
- [x] Note layout proportions give the content panel the majority of horizontal space
- [x] No regressions on existing component tests after CSS changes
- [x] Visually verified on 1280px and 768px viewport widths

---

## Slice 7.8-F — Optimistic card state sync

**Status:** Done

**Value:** The home screen shows the correct note title the moment you return from editing, and a note disappears from a folder's preview panel the instant it is dragged to another folder. No stale data, no lag.

**Root cause:** Note card state is siloed in individual components. `ListView` and `FolderPreviewPanel` each fetch their own `cards` in a local `useState` on mount. `useNotes.rename` updates the sidebar's `notes` list but has no way to reach the `cards` in `ListView`. Similarly, when a note is moved out of a folder panel, only the destination panel updates; the source panel's local state is untouched until it remounts.

**Two bugs, one fix:** Lift `cards` state out of `ListView` and `FolderPreviewPanel` and into `App` via a `useReducer`-backed hook. Each card-mutating operation dispatches an explicit action (client-side event); the reducer applies it. Optimistic reverts are compensating actions — the same pattern the backend uses.

**Architectural approach — explicit event handlers with `useReducer`:**

Because this is an event-sourced system, frontend state transitions should mirror that model. Rather than scattering ad-hoc `setState` calls across handlers, shared card state is managed by a `useReducer` with explicit action types. Each card-mutating operation dispatches an action; the reducer applies it to produce the next state. Reverts are compensating actions dispatched on failure.

```ts
type CardAction =
  | { type: 'CARDS_LOADED';        cards: NoteCard[] }
  | { type: 'CARD_TITLE_UPDATED';  noteId: string; title: string }
  | { type: 'CARD_TITLE_REVERTED'; noteId: string; title: string }
  | { type: 'CARD_MOVED';          noteId: string; folderId: string | null }
  | { type: 'CARD_MOVE_REVERTED';  noteId: string; folderId: string | null }
  | { type: 'CARD_ADDED';          card: NoteCard }
  | { type: 'CARD_REMOVED';        noteId: string }
```

The reducer is a pure function — no side effects, no API calls — exactly like a backend aggregate. API calls live in the handlers that dispatch actions before and after the async call.

**Learning surface:** `useReducer` as a client-side projection; discriminated union action types as frontend events; pure reducer as the state machine — the same conceptual model as the backend aggregate applied to UI state.

**Changes in scope:**

- `web/src/hooks/useCardState.ts` — new hook: `useReducer` with the `CardAction` discriminated union; exposes `cards` and `dispatch`; initial load dispatches `CARDS_LOADED`
- `web/src/App.tsx` — use `useCardState`; rename handler dispatches `CARD_TITLE_UPDATED` optimistically then `CARD_TITLE_REVERTED` on failure; move handler dispatches `CARD_MOVED` optimistically then `CARD_MOVE_REVERTED` on failure; passes `cards` down to `ListView` and `FolderPreviewPanel`
- `web/src/components/ListView.tsx` — remove local `cards` state and `getNoteCards()` fetch; accept `cards` as a prop
- `web/src/components/FolderPreviewPanel.tsx` — remove local `cards` state; accept `cards` as a prop filtered to the folder
- `web/src/__tests__/useCardState.test.ts` — unit-test the reducer directly: each action type produces the correct next state; revert actions restore previous state
- `web/src/__tests__/ListView.test.tsx` — update to pass `cards` as a prop
- `web/src/__tests__/FolderPreviewPanel.test.tsx` — update similarly

**Scenarios:**

```
Scenario: Note title updates on the home screen immediately after renaming
  Given I am on the note screen and rename a note to "Q3 Planning"
  When  I navigate back to the home screen
  Then  the note card shows "Q3 Planning" immediately
  And   no refetch is needed before the correct title appears

Scenario: Note disappears from source folder panel immediately on move
  Given folder A's preview panel is open showing note "Meeting Notes"
  And   I drag "Meeting Notes" to folder B's preview panel
  When  the drop completes
  Then  "Meeting Notes" is removed from folder A's panel immediately
  And   "Meeting Notes" appears in folder B's panel immediately

Scenario: A failed rename reverts the card title
  Given I rename a note to "New Title" and the API call fails
  When  the rename request returns an error
  Then  the note card reverts to the original title on the home screen

Scenario: Note appears in destination folder home screen immediately on move
  Given I am viewing folder B's home screen (notes filtered to folder B)
  And   I move note "Meeting Notes" into folder B
  When  the move completes
  Then  "Meeting Notes" appears in folder B's home screen immediately
  And   no navigation or refresh is needed

Scenario: A failed move reverts both panels
  Given a note was dragged from folder A to folder B and the API call fails
  When  the move request returns an error
  Then  the note reappears in folder A's panel
  And   the note is removed from folder B's panel
```

**Acceptance criteria:**

- [x] `cards` state lives in `App` (or a shared hook); `ListView` and `FolderPreviewPanel` receive it as a prop
- [x] Renaming a note updates the matching card's title in shared state immediately (before API response)
- [x] Moving a note removes it from the source panel's cards immediately (optimistic)
- [x] Moving a note adds it to the destination folder's cards immediately (optimistic)
- [x] The folder home screen (filtered card list) reflects the move without navigation or refresh
- [x] Failed rename and failed move both revert the optimistic update
- [x] Component tests for `ListView` and `FolderPreviewPanel` updated to use props rather than internal fetches
- [x] No new `getNoteCards()` calls added — one fetch in `App`, shared downward

---

## Slice 7.8-G — Domain event dispatcher

**Status:** Not Started

**Value:** Projection updates are decoupled from command handlers. Adding a new projection is a new class; it does not require touching an existing command handler. The command handler shrinks to two dependencies (`IEventStore` and `IDomainEventDispatcher`) and knows nothing about which projections exist.

**Problem with the current design:** `NoteCommandHandler` takes five projection store dependencies and owns a 50-line `UpdateProjectionAsync` method that hard-codes every projection update. Every new projection requires modifying both the constructor and that method. This is the opposite of the Open/Closed Principle and makes the command handler a bottleneck for all projection work.

**Design — in-process synchronous dispatcher:**

Keep the update synchronous and in-process so read-after-write consistency is preserved (projection is updated before the HTTP response returns). The dispatcher is not a message bus — it is a structured way to route events to projection handlers within the same request.

```csharp
// src/Api/IDomainEventDispatcher.cs
public interface IDomainEventDispatcher
{
    Task DispatchAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default);
}

// src/Api/IDomainEventHandler.cs
public interface IDomainEventHandler
{
    Task HandleAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default);
}

// src/Api/DomainEventDispatcher.cs
public sealed class DomainEventDispatcher(IEnumerable<IDomainEventHandler> handlers) : IDomainEventDispatcher
{
    public async Task DispatchAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct)
    {
        foreach (var handler in handlers)
            await handler.HandleAsync(events, ct).ConfigureAwait(false);
    }
}
```

Each existing projection becomes a dedicated `IDomainEventHandler` class:

| Handler class | Replaces |
|---|---|
| `NoteTitleListEventHandler` | `projStore` logic in `UpdateProjectionAsync` |
| `NoteDetailEventHandler` | `noteDetailStore` logic |
| `NoteCardListEventHandler` | `noteCardListStore` logic + `ApplyNoteEventsToCard` |
| `TodoListEventHandler` | `todoListStore` logic |
| `TagIndexEventHandler` | `tagIndexStore` logic |

`NoteCommandHandler` after the refactor:

```csharp
public sealed class NoteCommandHandler(IEventStore store, IDomainEventDispatcher dispatcher)
{
    private async Task PersistAsync(...)
    {
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        await dispatcher.DispatchAsync(envelopes, ct).ConfigureAwait(false);
    }
}
```

**Changes in scope:**

- `src/Api/IDomainEventDispatcher.cs` — new interface
- `src/Api/IDomainEventHandler.cs` — new interface
- `src/Api/DomainEventDispatcher.cs` — new: iterates registered handlers in registration order
- `src/Api/Projections/NoteTitleListEventHandler.cs` — new: extracted from `UpdateProjectionAsync`
- `src/Api/Projections/NoteDetailEventHandler.cs` — new: extracted from `UpdateProjectionAsync`
- `src/Api/Projections/NoteCardListEventHandler.cs` — new: extracted from `UpdateProjectionAsync` + `ApplyNoteEventsToCard`
- `src/Api/Projections/TodoListEventHandler.cs` — new: extracted from `UpdateProjectionAsync`
- `src/Api/Projections/TagIndexEventHandler.cs` — new: extracted from `UpdateProjectionAsync`
- `src/Api/NoteCommandHandler.cs` — remove all projection store dependencies and `UpdateProjectionAsync`; add `IDomainEventDispatcher`; call `dispatcher.DispatchAsync` in `PersistAsync`
- `src/Api/Builder.cs` — register `DomainEventDispatcher` as `IDomainEventDispatcher`; register each handler as `IDomainEventHandler` (order preserved)
- `tests/Api.Integration/` — no behaviour changes; all existing tests must pass unchanged

**Scenarios:**

```
Scenario: All projections are updated after a command is handled
  Given a note exists
  When  RenameNote is handled
  Then  the NoteTitleList projection reflects the new title
  And   the NoteDetail projection reflects the new title
  And   the NoteCardList projection reflects the new title

Scenario: A new projection handler can be added without changing NoteCommandHandler
  Given a new IDomainEventHandler is registered in Builder.cs
  When  any command is handled
  Then  the new handler receives the events
  And   NoteCommandHandler has not been modified

Scenario: Projection updates remain synchronous — read-after-write is consistent
  Given RenameNote is handled
  When  the HTTP response is returned
  Then  GET /notes/{id} already reflects the new title
  And   no eventual-consistency delay is observable
```

**Acceptance criteria:**

- [ ] `IDomainEventDispatcher` and `IDomainEventHandler` interfaces exist in `src/Api/`
- [ ] Five event handler classes extracted; each handles only its own projection's stores
- [ ] `NoteCommandHandler` constructor takes only `IEventStore` and `IDomainEventDispatcher`
- [ ] `UpdateProjectionAsync` and `ApplyNoteEventsToCard` removed from `NoteCommandHandler`
- [ ] All existing `Api.Integration` tests pass unchanged (behaviour is identical)
- [ ] `Domain.Specs` tests pass unchanged
- [ ] `cdk synth` exits 0

---

## Slice 7.8-H — Human-readable URLs

**Status:** Not Started

**Value:** The app is reachable at a memorable URL for both environments (`test.` subdomain for test, apex or `www.` for production) rather than opaque CloudFront and API Gateway hostnames. This also removes the `VITE_API_URL` build-time coupling — the frontend calls relative `/api/*` paths and CloudFront proxies them to API Gateway.

**Addresses backlog item:** *CloudFront proxy for API (remove VITE_API_URL build-time coupling)* — once a custom domain is on CloudFront, adding the `/api` behaviour is a natural part of the same CDK change.

**Prerequisites (manual — not code):**
1. Own a domain (e.g. `example.com`) with DNS manageable via Route 53 or an external provider.
2. Create a Route 53 hosted zone for the domain (if not already in place).
3. Decide on the subdomain convention — e.g. `notes-test.example.com` / `notes.example.com`.
4. Add `DOMAIN_NAME` (e.g. `notes.example.com`) and `HOSTED_ZONE_ID` as environment secrets in both GitHub environments (`Test` and `Production`). The Test environment uses a subdomain prefix; Production uses the bare domain.

**CDK changes:**

The CDK stack accepts two new optional context/env values: `DomainName` and `HostedZoneId`. When present:

1. **ACM certificate** — request a `DnsValidatedCertificate` in `us-east-1` (required for CloudFront). Validated automatically via Route 53 if the hosted zone is in the same account; otherwise output the CNAME record for manual DNS entry.
2. **CloudFront custom domain** — add `domainNames: [domainName]` and `certificate` to the existing `Distribution`.
3. **CloudFront `/api` behaviour** — add a second `CacheBehavior` for path pattern `/api/*` pointing to the API Gateway origin; add a `CloudFront Function` that strips the `/api` prefix before forwarding to API Gateway.
4. **Route 53 alias record** — create an `ARecord` pointing the domain to the CloudFront distribution.
5. **CDK outputs** — `WebUrl` output switches from the CloudFront default domain to the custom domain when configured; `ApiUrl` output is removed (the API is now accessed via CloudFront `/api`).
6. **`VITE_API_URL` removed** — the deploy workflow no longer passes `VITE_API_URL` to the frontend build; `web/src/api.ts` switches to relative `/api` paths.

When `DomainName` is not set (local `cdk synth`, PR checks) the stack deploys as before with the CloudFront default URL — no breakage.

**Key implementation files:**

- `src/Infrastructure/NoteTakerStack.cs` — add optional `DomainName`/`HostedZoneId` props; ACM cert; CloudFront custom domain + `/api` behaviour + CloudFront Function; Route 53 alias record
- `web/src/api.ts` — replace `import.meta.env.VITE_API_URL` base URL with `""` (empty string = relative paths)
- `.github/workflows/deploy.yml` — remove `VITE_API_URL` env var from "Build frontend" steps in both `deploy` and `deploy-production` jobs; add `DOMAIN_NAME` / `HOSTED_ZONE_ID` as CDK context or env vars
- `tests/Infrastructure.Assertions/` — add assertions: ACM cert present when domain configured; CloudFront has custom domain alias; `/api` behaviour present; Route 53 record present

**Scenarios:**

```
Scenario: The app is reachable at the custom domain in Test
  Given the Test environment is deployed with DOMAIN_NAME=notes-test.example.com
  When  I navigate to https://notes-test.example.com
  Then  the app loads correctly

Scenario: The app is reachable at the custom domain in Production
  Given the Production environment is deployed with DOMAIN_NAME=notes.example.com
  When  I navigate to https://notes.example.com
  Then  the app loads correctly

Scenario: API calls use relative paths — no VITE_API_URL needed at build time
  Given the frontend bundle is built without VITE_API_URL
  When  the app makes an API call
  Then  the request goes to /api/notes (relative)
  And   CloudFront proxies it to API Gateway

Scenario: CDK synth without a domain name produces no certificate or alias record
  Given DomainName is not set in the CDK context
  When  cdk synth runs
  Then  no ACM certificate resource is in the template
  And   the CloudFront distribution uses only its default domain
```

**Acceptance criteria:**

- [ ] Prerequisites met: domain owned, Route 53 hosted zone created, `DOMAIN_NAME` + `HOSTED_ZONE_ID` secrets added to both GitHub environments
- [ ] CDK stack creates ACM certificate and CloudFront alias when `DomainName` is set; skips both when unset
- [ ] CloudFront `/api/*` behaviour strips prefix and forwards to API Gateway
- [ ] `web/src/api.ts` uses relative `/api` base path; `VITE_API_URL` removed from codebase
- [ ] `deploy.yml` no longer passes `VITE_API_URL` to the frontend build
- [ ] App reachable at `DOMAIN_NAME` for both Test and Production after deploy
- [ ] `InfraAssertions` tests cover cert, alias, and `/api` behaviour presence
- [ ] `cdk synth` (no domain) exits 0 with no cert or alias record in template
- [ ] CloudFront proxy backlog item closed
