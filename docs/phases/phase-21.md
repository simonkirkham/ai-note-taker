# Phase 21 — URL routing: distinct URLs, working back/forward, shareable note links

**Goal:** Give every screen a distinct browser URL so the back/forward buttons work and a specific note (or folder) can be linked and reopened directly. Today the frontend has **no router** — `App.tsx` holds a single in-memory `view` union (`list` | `folder` | `note`) and opening a note is just `setView({ kind: "note", noteId })`, so the URL never changes, history is a no-op, and `/notes/:id` cannot be shared. Adopt **react-router-dom** (decision recorded in **[ADR 0013](../adr/0013-adopt-react-router-dom.md)**) and map the three surfaces to real routes. Frontend-only — no event model, no API, no backend change. CloudFront already rewrites unknown paths to `index.html` (`CloudFront_HasTwoFunctions_SpaRoutingAndApiStrip`), so deep-linked hard loads already serve the SPA.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| Gate | **ADR 0013 — adopt react-router-dom.** Record why a router (deep-linking + history) now earns a dependency in this learning-vehicle frontend. No code. | Not Started | — |
| 21-A | **Router foundation + note & home URLs.** Install `react-router-dom`; mount `<BrowserRouter>`; routes `/` (home) and `/notes/:noteId`; convert note open/back/create to `navigate()`; remove the `note` arm of the `view` union. Back/forward + deep-link + shareable note URL. | Not Started | Gate |
| 21-B | **Folder URLs.** Route `/folders/:folderId` (+ `/folders/unfiled`); derive `folderPath` from the folder tree by id; remove the `folder` arm of the `view` union. Back/forward across folders + home; deep-link to a folder. | Not Started | 21-A |
| 21-C | **Deep-link edge cases.** Missing/deleted note → redirect home with a toast; signed-out deep link returns to the requested URL after sign-in; verify CloudFront serves a hard-loaded deep link (smoke/E2E). | Not Started | 21-A, 21-B |

> **21-A is the keystone** — it introduces the router and sets the `navigate()`/`useParams` pattern every later slice copies; get the route table and the new-note navigation right before fanning out. 21-B and 21-C both depend on it; 21-B and 21-C both touch `App.tsx` route wiring, so sequence them (B then C). **Transient surfaces stay in component state, not the URL:** the folder sidebar, the folder-preview pull-out, and the Transcript/Quick/Final note tabs are *not* routed in this phase (note tabs are a candidate follow-up). The optimistic-UI rule (CLAUDE.md) applies to navigation too — `navigate()` must fire synchronously on the user action, never after an `await`.

**Learning surface:** client-side routing on an SPA (history stack, `popstate`, scroll/focus on navigation); mapping a hand-rolled view-state union onto a declarative route table; `useParams`/`useNavigate`/`<Navigate>`; deep-linking against an already-configured CloudFront SPA rewrite; the auth-gate-vs-route ordering problem (a signed-out deep link must survive sign-in); and the dependency tradeoff of adopting a router in a deliberately hand-rolled frontend (contrast [ADR 0010](../adr/0010-server-state-strategy.md), which kept server-state hand-rolled).

## Observability

Frontend-only; the silent failure modes are all on the deep-link/hard-load path, invisible to backend logs:

| Risk | Make it visible |
|------|-----------------|
| Deep-link to a deleted/nonexistent note renders blank instead of recovering | 21-C redirects home + toast; the redirect is a RUM custom event so the rate is visible |
| CloudFront stops rewriting a new path prefix → hard load 404s | `CloudFront_HasTwoFunctions_SpaRoutingAndApiStrip` assertion covers it; 21-C adds a smoke/E2E hard-load of `/notes/:id` |
| Route changes not captured in RUM (can't see which screens users land on) | Confirm CloudWatch RUM page-view tracking follows `pushState` (SPA mode); add the route as a page-id if not |

---

## Slice 21-A — Router foundation + note & home URLs

**User value:** Open a note and the URL becomes `/notes/:id` — copy it, share it, reload it, and the note opens. Back returns to where you were; forward reopens the note.

### How it works (implementation notes)

- Install `react-router-dom` (**on Node 20 to match CI** before committing `package-lock.json` — see the npm-version guardrail).
- `<BrowserRouter>` wraps `<App>` in `main.tsx`, **inside** the existing providers' tree so the auth short-circuit (`SignInPage` / `SessionExpiredBanner`) still renders for any route.
- Route table: `/` → home; `/notes/:noteId` → note screen. The `view` union loses its `note` arm; `noteId` comes from `useParams`, and `App` derives "am I on a note?" from the route, not state.
- Replace `setView({ kind: "note", ... })` call sites (`onOpenNote`, `onEditNote`, the create flow, `onBack`) with `useNavigate()`. `onBack` uses `navigate(-1)` where a real history entry exists, else `navigate('/')`.
- **New-note flow:** keep the optimistic create (returns `noteId` synchronously), then `navigate('/notes/' + noteId)`; pass `isNew`/`initialTitle` via router location `state`, not the URL. Back from a freshly created note must not re-create it.
- `key={noteId}` on the note screen is preserved via the route param so remount-on-note-change behaviour is unchanged.

### Scenarios

```
Scenario: Opening a note pushes a note URL
  Given the home screen at "/"
  When I open the note "abc"
  Then the URL is "/notes/abc" and the note screen renders

Scenario: Back returns to the previous screen
  Given I opened note "abc" from "/"
  When I press the browser Back button
  Then the URL is "/" and the home screen renders

Scenario: Forward reopens the note
  Given I pressed Back from note "abc"
  When I press the browser Forward button
  Then the URL is "/notes/abc" and the note screen renders

Scenario: Deep-link loads the note directly
  Given a cold load of "/notes/abc"
  Then the note screen for "abc" renders

Scenario: Creating a note navigates without a recreate on Back
  Given the home screen
  When I create a new note
  Then the URL is "/notes/<newId>"
  And pressing Back returns to "/" without creating a second note
```

### Acceptance criteria

- `react-router-dom` added; `<BrowserRouter>` mounted inside the provider tree; auth short-circuit unaffected.
- `/` and `/notes/:noteId` routes live; the `view` union's `note` arm removed.
- Navigation fires synchronously on user action (optimistic-UI rule); no `await` before `navigate()`.
- Existing Vitest/RTL suite green (update tests that asserted on `view` state to assert on the route); Browser.E2E journeys green.

---

## Slice 21-B — Folder URLs

**User value:** A folder view has its own URL; back/forward steps through folder navigation, and a folder can be linked directly.

### How it works (implementation notes)

- Route `/folders/:folderId`; `/folders/unfiled` for the Unfiled Notes view (`UNFILED_ID`). **One flat id segment handles any depth** — `folderId` is unique regardless of where the folder sits in the tree, so a sub-folder needs no nested URL. Deliberately *not* `/folders/parent/child` (name paths rot on rename/reparent and need name→id disambiguation; the id is stable across the reparent/cascade events).
- `folderPath` (breadcrumb/heading, e.g. `Parent → Child`) is **derived from the folder tree by walking ancestors of `folderId` up to the root**, not carried in the URL — the tree is already loaded in `App` (today the caller passes `folderPath` in; a deep-load has only the id, so reconstruct it). On a deep load before the tree resolves, show the existing loading state, then fill the path. A sub-folder deep-link therefore renders the full breadcrumb, not just the leaf name.
- Remove the `folder` arm of the `view` union; folder selection becomes `navigate('/folders/' + id)`.
- The folder **sidebar** and **preview pull-out** stay in component state — they are transient overlays, not destinations.

### Scenarios

```
Scenario: Opening a folder pushes a folder URL
  Given the home screen
  When I open folder "f1"
  Then the URL is "/folders/f1" and the folder view renders

Scenario: Back/forward steps through folder history
  Given I navigated "/" → "/folders/f1" → "/folders/f2"
  When I press Back twice
  Then I am back at "/" via "/folders/f1"

Scenario: Deep-link to a folder shows the right heading
  Given a cold load of "/folders/f1"
  Then the folder view for "f1" renders with its folder path heading once the tree loads

Scenario: Deep-link to a sub-folder rebuilds the full breadcrumb
  Given "child" is nested under "parent"
  When I cold-load "/folders/child"
  Then the heading reads "parent → child" once the tree loads

Scenario: Unfiled notes has its own URL
  When I open Unfiled Notes
  Then the URL is "/folders/unfiled"
```

### Acceptance criteria

- `/folders/:folderId` and `/folders/unfiled` routes live; the `view` union's `folder` arm removed (union now collapses to route-derived rendering).
- `folderPath` derived from the tree; deep-load shows loading then the correct heading.
- Sidebar/preview remain component state (not routed).
- Vitest/RTL + Browser.E2E green.

---

## Slice 21-C — Deep-link edge cases

**User value:** A stale or shared link to a note that no longer exists recovers gracefully instead of breaking; a shared link works even when the recipient has to sign in first.

### How it works (implementation notes)

- **Missing note:** `getNoteDetail` 404 on a deep load → `<Navigate to="/" replace>` + a toast ("That note no longer exists"); emit a RUM custom event so the rate is observable.
- **Signed-out deep link:** the auth gate renders `SignInPage` while preserving the current URL; after sign-in the router re-renders the original route and the note/folder loads. No redirect-to-`/` on sign-in.
- **Hard-load coverage:** add a Browser.E2E (or Api.Smoke front-door) check that a cold GET of `/notes/<id>` returns the SPA shell (CloudFront rewrite), guarding the assertion at runtime.
- Unknown route (`*`) → `<Navigate to="/" replace>`.

### Scenarios

```
Scenario: Deep-link to a deleted note recovers
  Given a cold load of "/notes/deleted-id"
  When the note fetch returns 404
  Then I am redirected to "/" and shown a toast

Scenario: Signed-out deep link survives sign-in
  Given I am signed out and load "/notes/abc"
  When I sign in
  Then the note "abc" screen renders (not the home screen)

Scenario: Unknown route falls back home
  Given a cold load of "/nonsense"
  Then I am redirected to "/"

Scenario: Hard load of a note URL serves the SPA
  Given CloudFront serves "/notes/abc" on a cold browser load
  Then the app shell loads and routes to the note
```

### Acceptance criteria

- 404 on note deep-load → redirect home + toast + RUM event.
- Sign-in preserves and restores the originally requested URL.
- `*` route redirects home.
- Hard-load deep-link coverage added (E2E or smoke); existing suites green.
