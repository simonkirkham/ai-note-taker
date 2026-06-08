# Phase 6.5 — Frontend Component Tests

**Goal:** Replace the current approach of using Playwright E2E tests as the primary UI regression safety net with a fast, deterministic component test layer. E2E tests are kept for key full-stack journey smoke checks only. A rename pass gives all test projects names that describe what they cover.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 6.5-A | Rename test projects (pure refactor) | Done | — |
| 6.5-B | Vitest scaffold — install tooling, wire CI, one smoke test | Done | 6.5-A |
| 6.5-C | Home screen component tests (NoteCard, TagFilter, TodoSection) | Done | 6.5-B |
| 6.5-D | Note view component tests (NoteView, ActionsSection, Sidebar) | Done | 6.5-C |

6.5-C removes 4 E2E journeys (NoteCard, TagFilter, TodoList, TodoComplete); 6.5-D removes 8 more (NoteContent, NoteDate, NoteDateDefaults, NoteLayout, ActionItemComplete, DeleteAction, ImplicitActionAdd, Sidebar), trimming Browser.E2E to exactly 5 kept journeys and cleaning up `AppPage.cs`.

---

## Slice 6.5-A — Rename test projects

**Status:** Done

### Scenarios

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

### Acceptance criteria

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

### Scenarios

```
Scenario: Vitest scaffold runs in CI
  When  npm run test is run from web/
  Then  the suite exits 0

Scenario: MSW server intercepts fetch without real network
  Given a handler returning a fixed JSON response
  When  the component calls fetch and renders
  Then  the component shows the mocked data and no real network call is made
```

### Acceptance criteria

- [x] `npm run test` exits 0 from `web/`
- [x] `pr.yml` and `deploy.yml` both gate on `npm run test`
- [x] Smoke test does not import a real API URL or require a deployed backend
- [x] `web/src/test/setup.ts` configures MSW server lifecycle (`beforeAll` / `afterEach` / `afterAll`)

---

## Slice 6.5-C — Home screen component tests

**Status:** Done

### Scenarios

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

### Acceptance criteria

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

### Scenarios

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

### Acceptance criteria

- [x] `npm run test` exits 0 with all 3 new test files passing
- [x] No test imports a real API URL or requires a deployed backend
- [x] MSW handlers cover every fetch call made by the tested components
- [x] `vi.setSystemTime` used for date-default tests; no `Date.now()` calls left uncontrolled
- [x] All 8 journey files deleted; `dotnet build tests/Browser.E2E/Browser.E2E.csproj` exits 0
- [x] `AppPage.cs` contains no selectors used only by the deleted journeys
- [x] `ls tests/Browser.E2E/Journeys/` shows exactly 5 files
- [x] Each test asserts on visible output, not component state or CSS class names
