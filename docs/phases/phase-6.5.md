# Phase 6.5 — Frontend Component Tests

**Goal:** Replace the current approach of using Playwright E2E tests as the primary UI regression safety net with a fast, deterministic component test layer. E2E tests are kept for key full-stack journey smoke checks only. A rename pass gives all test projects names that describe what they cover.

**Learning surface:** Vitest as a Vite-native test runner; React Testing Library's "test what the user sees" philosophy vs implementation-detail testing; MSW intercepting fetch at the network boundary so component code never changes for tests; where in the testing pyramid each layer earns its cost; naming as documentation — project names that encode their scope reduce the time to find the right test.

---

## What changes

### Test project renames

| Old | New |
|-----|-----|
| `tests/Specs/` | `tests/Domain.Specs/` |
| `tests/EventStoreIntegration/` | `tests/EventStore.Integration/` |
| `tests/ApiIntegration/` | `tests/Api.Integration/` |
| `tests/Acceptance/` | `tests/Api.Smoke/` |
| `tests/InfraAssertions/` | `tests/Infrastructure.Assertions/` |
| `tests/E2E/` | `tests/Browser.E2E/` |

### New test layer

| Layer | Type | Tool | Location | Run on |
|-------|------|------|----------|--------|
| 7 — Frontend components | Component (in-process) | Vitest + RTL + MSW | `web/src/__tests__/` | Every PR |

### Browser.E2E — journeys to remove (12)

The full E2E suite has 17 journey files. 5 are kept (see ADR 0008); the remaining 12 are replaced by component tests in 6.5-C and 6.5-D:

`ActionItemCompleteJourney`, `DeleteActionJourney`, `ImplicitActionAddJourney`, `NoteCardJourney`, `NoteContentJourney`, `NoteDateDefaultsJourney`, `NoteDateJourney`, `NoteLayoutJourney`, `SidebarJourney`, `TagFilterJourney`, `TodoCompleteJourney`, `TodoListJourney`

> `TagFilterJourney` was missing from the original remove list but belongs here: it tests only filter-bar UI interaction (no wiring path unique to production).

---

## Slice order and dependencies

```
6.5-A  Rename test projects — pure refactor, no behaviour change
6.5-B  Vitest scaffold — install tooling, wire CI, one smoke test       (depends 6.5-A — uses new project names in CI)
6.5-C  Home screen component tests — NoteCard, TagFilter, TodoSection   (depends 6.5-B)
        → removes 4 E2E journeys: NoteCardJourney, TagFilterJourney, TodoListJourney, TodoCompleteJourney
6.5-D  Note view component tests — NoteView, ActionsSection, Sidebar    (depends 6.5-C — reuses MSW handler patterns)
        → removes 8 E2E journeys: NoteContentJourney, NoteDateJourney, NoteDateDefaultsJourney,
          NoteLayoutJourney, ActionItemCompleteJourney, DeleteActionJourney, ImplicitActionAddJourney,
          SidebarJourney
        → Browser.E2E is now trimmed to exactly 5 kept journeys; AppPage.cs cleaned up
```

---

## Slice 6.5-A — Rename test projects

**Status:** Done

**Value:** Test project names that make their scope legible at a glance. Any engineer opening the `tests/` directory knows which project to reach for without reading a map.

**Changes in scope:**

- Six directory renames (`git mv`)
- Six `.csproj` file renames
- C# namespace declarations updated across all `.cs` files in each project
- `ai-note-taker.sln` project display names and paths updated
- `.github/workflows/pr.yml` — four `dotnet test` paths updated
- `.github/workflows/deploy.yml` — five `dotnet test`/`dotnet build` paths updated; `playwright.ps1` path updated
- `CLAUDE.md` — layout table and `How to run` commands updated
- `docs/roadmap.md` — Phase 1.5 bullet paths updated
- `docs/adr/0008-testing-strategy.md` — layer table and all prose updated

**Key implementation files:**
- `ai-note-taker.sln`
- `.github/workflows/pr.yml`
- `.github/workflows/deploy.yml`
- `CLAUDE.md`
- `docs/roadmap.md`
- `docs/adr/0008-testing-strategy.md`

**Scenarios:**

```
Scenario: Solution builds clean after rename
  Given all six projects are renamed in directory, .csproj, namespaces, and .sln
  When  dotnet build ai-note-taker.sln is run
  Then  0 errors and 0 warnings

Scenario: Domain specs pass under new name
  When  dotnet test tests/Domain.Specs/Domain.Specs.csproj is run
  Then  all specs pass

Scenario: EventStore integration tests pass under new name
  When  dotnet test tests/EventStore.Integration/EventStore.Integration.csproj is run
  Then  all tests pass

Scenario: API integration tests pass under new name
  When  dotnet test tests/Api.Integration/Api.Integration.csproj is run
  Then  all tests pass

Scenario: Infrastructure assertions pass under new name
  When  dotnet test tests/Infrastructure.Assertions/Infrastructure.Assertions.csproj is run
  Then  all assertions pass
```

**Acceptance criteria:**

- [x] All six directories, `.csproj` files, and C# namespaces renamed
- [x] `ai-note-taker.sln` references updated
- [x] `pr.yml` and `deploy.yml` paths updated
- [x] `CLAUDE.md`, `docs/roadmap.md`, `docs/adr/0008-testing-strategy.md` updated
- [x] `dotnet build ai-note-taker.sln` exits 0, 0 errors, 0 warnings
- [x] `dotnet test tests/Domain.Specs/Domain.Specs.csproj` — all green
- [x] `dotnet test tests/Api.Integration/Api.Integration.csproj` — all green
- [x] `dotnet test tests/Infrastructure.Assertions/Infrastructure.Assertions.csproj` — all green

---

## Slice 6.5-B — Vitest scaffold

**Status:** Done

**Value:** The test infrastructure that all component tests depend on: Vitest wired to Vite, jsdom, RTL matchers, and an MSW server that intercepts `fetch` at the network boundary. CI gates on `npm run test` from this slice onwards.

**Learning surface:** How MSW intercepts `fetch` at the network boundary rather than mocking modules — components call `fetch` exactly as in production, MSW responds in-process; `jsdom` as a headless DOM environment; React Testing Library's `screen.getByRole` / `findByText` query hierarchy and why it mirrors how a user reads the page.

**Changes in scope:**

- `web/package.json`: add `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`, `jsdom` to `devDependencies`; add `"test": "vitest run"` script
- `web/vite.config.ts`: add `test` block (`environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `globals: true`)
- `web/src/test/setup.ts`: import `@testing-library/jest-dom`; configure MSW server lifecycle (`beforeAll` / `afterEach` / `afterAll`)
- `web/src/test/handlers.ts`: MSW request handlers for all API routes (built out across B, C, D — start with the routes the smoke test needs)
- `web/src/__tests__/scaffold.test.tsx`: one smoke test that renders a trivial component to prove the scaffold works end-to-end
- `.github/workflows/pr.yml`: add `npm run test` step in the frontend section
- `.github/workflows/deploy.yml`: add `npm run test` step in the `validate` job

**Key implementation files:**
- `web/package.json`
- `web/vite.config.ts`
- `web/src/test/setup.ts`
- `web/src/test/handlers.ts`
- `web/src/__tests__/scaffold.test.tsx`

**Scenarios:**

```
Scenario: Vitest scaffold runs in CI
  When  npm run test is run from web/
  Then  the suite exits 0

Scenario: MSW server intercepts fetch without real network
  Given a handler returning a fixed JSON response
  When  the component calls fetch and renders
  Then  the component shows the mocked data and no real network call is made
```

**Acceptance criteria:**

- [x] `npm run test` exits 0 from `web/`
- [x] `pr.yml` and `deploy.yml` both gate on `npm run test`
- [x] Smoke test does not import a real API URL or require a deployed backend
- [x] `web/src/test/setup.ts` configures MSW server lifecycle (`beforeAll` / `afterEach` / `afterAll`)

---

## Slice 6.5-C — Home screen component tests

**Status:** Done

**Value:** Component tests for every piece of UI visible on the home/list screen. Four E2E journeys are deleted once their behaviours are covered here, making the Playwright suite faster and cheaper to run.

**Changes in scope:**

- `web/src/__tests__/NoteCard.test.tsx` — written
- `web/src/__tests__/TagFilter.test.tsx` — written
- `web/src/__tests__/TodoSection.test.tsx` — written
- `web/src/test/handlers.ts` — extended with handlers for `GET /notes/cards`, `GET /tags`, `GET /todos`
- `tests/Browser.E2E/Journeys/NoteCardJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/TagFilterJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/TodoListJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/TodoCompleteJourney.cs` — deleted
- `tests/Browser.E2E/Pages/AppPage.cs` — remove selectors used only by the 4 deleted journeys

**E2E behaviours replaced and their component test equivalents:**

### NoteCard.test.tsx → replaces `NoteCardJourney`

| E2E test | Component test equivalent |
|----------|--------------------------|
| Home screen shows card for each note | MSW returns 2 cards → both titles visible in rendered NoteCard list |
| Card shows content snippet | MSW returns card with `snippet` → snippet text visible on card |
| Card shows open action items | MSW returns card with `openActionCount: 1, firstAction: "Send recap email"` → action text visible |
| EditNote button opens the note | `onEdit` callback prop called when Edit button clicked |
| Deleted note card disappears | Covered by `NoteDeleteJourney` (kept as E2E) — not duplicated |

### TagFilter.test.tsx → replaces `TagFilterJourney`

| E2E test | Component test equivalent |
|----------|--------------------------|
| Tag filter pill appears after tag added | MSW GET /tags returns `["filtertest"]` → pill labelled "filtertest" visible |
| Clicking pill filters cards | Two cards rendered; clicking tag pill → only matching card remains visible |
| Clear button shows all cards | Tag filter active → click clear → both cards visible |
| AND/OR toggle appears with 2 tags selected | Two tag pills clicked → mode toggle button visible; clicking it changes mode |

### TodoSection.test.tsx → replaces `TodoListJourney` + `TodoCompleteJourney`

| E2E test | Component test equivalent |
|----------|--------------------------|
| Home screen shows open todo items from all notes | MSW GET /todos returns 2 items → both descriptions visible |
| Completing todo removes it from list | Checkbox clicked → MSW POST /complete called → item disappears from list |
| Completing todo reflects in note | Full-stack concern — covered by `ActionItemJourney` (kept as E2E) |

**Key implementation files:**
- `web/src/__tests__/NoteCard.test.tsx`
- `web/src/__tests__/TagFilter.test.tsx`
- `web/src/__tests__/TodoSection.test.tsx`
- `web/src/test/handlers.ts` (extended)
- `tests/Browser.E2E/Journeys/NoteCardJourney.cs` (deleted)
- `tests/Browser.E2E/Journeys/TagFilterJourney.cs` (deleted)
- `tests/Browser.E2E/Journeys/TodoListJourney.cs` (deleted)
- `tests/Browser.E2E/Journeys/TodoCompleteJourney.cs` (deleted)
- `tests/Browser.E2E/Pages/AppPage.cs` (selectors pruned)

**Scenarios:**

```
Scenario: Note card renders title and snippet from API data
  Given MSW returns a card with title "Q1 Review" and snippet "We discussed..."
  When  the card list renders
  Then  "Q1 Review" and "We discussed..." are both visible

Scenario: Clicking a tag pill hides cards that do not match
  Given cards titled "Alpha" (tagged "meeting") and "Beta" (untagged) are visible
  When  the user clicks the "meeting" tag pill
  Then  "Alpha" is visible and "Beta" is absent

Scenario: Clear button restores all cards after filtering
  Given "meeting" tag filter is active and "Beta" is hidden
  When  the user clicks the clear button
  Then  both "Alpha" and "Beta" are visible

Scenario: Todo list renders open items from the API
  Given MSW GET /todos returns ["Chase invoice", "Send recap"]
  When  TodoSection renders
  Then  both descriptions are visible on screen

Scenario: Completing a todo removes it from the list
  Given "Chase invoice" is visible in the todo list
  When  the user clicks its checkbox
  Then  POST /todos/:id/complete is called and "Chase invoice" is absent
```

**Acceptance criteria:**

- [x] `npm run test` exits 0 with all 3 new test files passing
- [x] No test imports a real API URL or uses `API_BASE_URL`
- [x] MSW handlers cover every fetch call made by the tested components
- [x] Each test asserts on visible output, not component state or CSS class names
- [x] `NoteCardJourney.cs`, `TagFilterJourney.cs`, `TodoListJourney.cs`, `TodoCompleteJourney.cs` are deleted
- [x] `AppPage.cs` compiles with no references to the removed selectors
- [x] `dotnet build tests/Browser.E2E/Browser.E2E.csproj` exits 0 after deletions

---

## Slice 6.5-D — Note view component tests

**Status:** Done

**Value:** Component tests for every piece of UI visible when editing a note: content editing, date defaults, action item interactions, and sidebar state. Eight E2E journeys are deleted after this slice, leaving the Playwright suite with exactly 5 kept journeys. `AppPage.cs` is fully cleaned of now-unused selectors.

**Changes in scope:**

- `web/src/__tests__/NoteView.test.tsx` — written
- `web/src/__tests__/ActionsSection.test.tsx` — written
- `web/src/__tests__/Sidebar.test.tsx` — written
- `web/src/test/handlers.ts` — extended with handlers for `GET /notes/:id`, `PUT /notes/:id/content`, `PATCH /notes/:id/date`, `GET /notes/:id/actions`, `POST /notes/:id/actions`, `POST /notes/:id/actions/:aid/complete`, `POST /notes/:id/actions/:aid/reopen`, `DELETE /notes/:id/actions/:aid`
- `tests/Browser.E2E/Journeys/NoteContentJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/NoteDateJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/NoteDateDefaultsJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/NoteLayoutJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/ActionItemCompleteJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/DeleteActionJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/ImplicitActionAddJourney.cs` — deleted
- `tests/Browser.E2E/Journeys/SidebarJourney.cs` — deleted
- `tests/Browser.E2E/Pages/AppPage.cs` — remove all remaining selectors used only by deleted journeys

**E2E behaviours replaced and their component test equivalents:**

### NoteView.test.tsx → replaces `NoteContentJourney`, `NoteDateJourney`, `NoteDateDefaultsJourney`, `NoteLayoutJourney`

| E2E test | Component test equivalent |
|----------|--------------------------|
| Opening a new note shows an empty content area | MSW GET /notes/:id returns `content: ""` → textarea visible and empty |
| Typing content and blurring saves it | User types in textarea and blurs → PUT /content called with typed text |
| Content persists after navigation | MSW GET /notes/:id returns `content: "saved text"` → textarea shows "saved text" |
| Clearing content saves empty | User clears textarea and blurs → PUT /content called with `""` |
| New note date defaults to today | `vi.setSystemTime("2026-01-15")` + MSW returns `date: null` → date input value is "2026-01-15" |
| No formatted date label visible on new note | MSW returns `date: null` → note-date-display element is absent |
| Date input saves on blur | User sets date to "2026-04-21" and blurs → PATCH /date called with "2026-04-21" |
| Date persists after navigation | MSW returns `date: "2026-04-21"` → date input shows "2026-04-21" |
| Captured notes label visible | NoteView renders → `data-testid="captured-notes-label"` is present |
| Actions panel right of content on desktop | Both `note-content` and `actions-section` are present in DOM *(jsdom cannot test bounding boxes; positional layout is a CSS-only concern not verifiable in jsdom)* |
| Actions panel stacks below content on mobile | Same limitation — presence of both panels is verified; layout is CSS |

### ActionsSection.test.tsx → replaces `ActionItemCompleteJourney`, `DeleteActionJourney`, `ImplicitActionAddJourney`

| E2E test | Component test equivalent |
|----------|--------------------------|
| Note with no actions shows empty state | MSW GET /actions returns `[]` → actions-empty element visible |
| Enter key adds item and clears input | User types "Book meeting" + presses Enter → POST /actions called; "Book meeting" appears; input is empty |
| Blur adds non-empty item | User types "Book the room" + blurs → POST /actions called; item appears |
| Blur on empty input does not add item | Empty input blurred → no POST call; empty state remains |
| No add button visible | ActionsSection renders → add-action-button is absent from DOM |
| Completing action marks checkbox checked | Checkbox clicked on open item → POST /complete called; checkbox is checked |
| Reopening shows as open | Checkbox clicked on completed item → POST /reopen called; checkbox unchecked |
| Deleting removes item from list | Delete button clicked → DELETE /actions/:id called; item absent from list |
| Action items persist across navigation | Full-stack concern — covered by `ActionItemJourney` (kept as E2E) |

### Sidebar.test.tsx → replaces `SidebarJourney`

| E2E test | Component test equivalent |
|----------|--------------------------|
| Note names appear in sidebar on home screen | Sidebar rendered with notes prop → both note titles visible |
| Clicking sidebar entry opens the note | Note title clicked → `onNoteSelect` callback called with the note's id |
| Sidebar is visible on note screen | Sidebar element present in DOM when rendered alongside NoteView |
| Active note is highlighted in sidebar | `activeNoteId` prop matching a note → that item has `sidebar-note-item--active` class |
| New note appears in sidebar immediately | Notes prop updated with new title → new title visible without re-mount |

**Key implementation files:**
- `web/src/__tests__/NoteView.test.tsx`
- `web/src/__tests__/ActionsSection.test.tsx`
- `web/src/__tests__/Sidebar.test.tsx`
- `web/src/test/handlers.ts` (extended)
- `tests/Browser.E2E/Journeys/` (8 deletions)
- `tests/Browser.E2E/Pages/AppPage.cs` (remaining unused selectors pruned)

**Scenarios:**

```
Scenario: Content area renders content returned by the API
  Given MSW GET /notes/:id returns content "Meeting notes"
  When  NoteView renders
  Then  the content textarea shows "Meeting notes"

Scenario: Blurring the content textarea triggers a save
  Given NoteView is rendered and the user types "New content"
  When  the textarea loses focus
  Then  PUT /notes/:id/content is called with "New content"

Scenario: Date defaults to today when API returns no date
  Given vi.setSystemTime is set to 2026-01-15 and MSW returns date: null
  When  NoteView renders
  Then  the date input value is "2026-01-15"

Scenario: Enter key adds action item and clears the input
  Given MSW GET /actions returns [] and POST /actions returns a new action id
  When  the user types "Chase invoice" and presses Enter
  Then  "Chase invoice" is visible in the actions list and the input is empty

Scenario: Completing an action item toggles its checkbox
  Given MSW returns one open action item
  When  the user clicks the checkbox
  Then  POST /complete is called and the checkbox is checked

Scenario: Active note is highlighted in the sidebar
  Given Sidebar renders with two notes and activeNoteId set to note-1
  When  the component renders
  Then  the note-1 item has the active CSS class and note-2 does not

Scenario: Browser.E2E contains exactly 5 journeys after all deletions
  Given all 12 redundant journey files are deleted across slices C and D
  When  ls tests/Browser.E2E/Journeys/ is run
  Then  exactly 5 journey files remain
```

**Acceptance criteria:**

- [x] `npm run test` exits 0 with all 3 new test files passing
- [x] No test imports a real API URL or requires a deployed backend
- [x] MSW handlers cover every fetch call made by the tested components
- [x] `vi.setSystemTime` used for date-default tests; no `Date.now()` calls left uncontrolled
- [x] All 8 journey files deleted; `dotnet build tests/Browser.E2E/Browser.E2E.csproj` exits 0
- [x] `AppPage.cs` contains no selectors used only by the deleted journeys
- [x] `ls tests/Browser.E2E/Journeys/` shows exactly 5 files
- [x] Each test asserts on visible output, not component state or CSS class names
