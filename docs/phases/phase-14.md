# Phase 14 — Frontend standards alignment — CSS Modules migration & tooling

**Goal:** Bring the `web/` frontend in line with the rewritten frontend standards (the `frontend-react` skill + `docs/react-coding-standards.md`). This is a **refactor/migration phase** — **no new user-facing behaviour, no backend changes, no event-model changes**. Every slice is structural: retire the single 2,816-line global `web/src/App.css` in favour of co-located CSS Modules, extract design tokens and a new `--space-*` scale into `styles/tokens.css` + `styles/global.css`, add the tooling the standards now mandate (`clsx`, `@/` path alias, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`), and add an error boundary. The acceptance bar for every slice is **"structure now matches the standard AND no visual or behavioural regression."** The existing Vitest/RTL component suite (25 files in `web/src/__tests__/`) and the Playwright (C#) `Browser.E2E` journeys are the regression net — they must stay green through every slice, and a manual visual smoke confirms no reskin.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 14-A | Foundation: `styles/tokens.css` + `styles/global.css`, `--space-*` scale, `clsx` dep, wire global imports | Done | — |
| 14-B | Pattern-setter migration: `SignInPage` → CSS Module (establishes the conventions the rest copy) | Done | 14-A |
| 14-C | Migrate `SessionExpiredBanner` + `ShortcutsPanel` (leaf, self-contained) | Done | 14-B |
| 14-D | Migrate `ThemePicker` + `FolderPicker` (small selects) | Done | 14-B |
| 14-E | Migrate `TagFilter` + `QuickCaptureTodoInput` (leaf inputs) | Done | 14-B |
| 14-F | Migrate `NoteCard` (home list card) | Done | 14-B |
| 14-G | Migrate `TagsSection` + `ActionsSection` (note-view right panel) | Done | 14-B |
| 14-H | Migrate `NoteEditor` (editor container + discussed button) | Done | 14-B |
| 14-I | Migrate `TodoSection` (todo + done + quick-capture sections) | Done | 14-B, 14-E |
| 14-J | Migrate `MeetingsSection` (meetings list + meeting card + status states) | Done | 14-B |
| 14-K | Migrate `FolderPreviewPanel` + `FolderTree` (folder tree + slide-out preview) | Done | 14-B |
| 14-L | Migrate `Sidebar` (folders section + app-shell sidebar chrome) | Done | 14-B, 14-K |
| 14-M | Migrate `ListView` (home two-column layout, breadcrumb, summary cards) | Done | 14-B |
| 14-N | Migrate `NoteView` (note header, two-column layout, status messages) | Done | 14-B, 14-G, 14-H |
| 14-O | ~~Migrate `TranscriptionPanel`~~ — **Dropped** (Phase 15-B deleted the component) | Dropped | 14-B |
| 14-P | Resolve remaining shared shell/utility classes (App shell → module, shared utilities → shared module, body/reduced-motion → global.css); remove `App.css` and its import | Done | 14-B…14-N |
| 14-Q | Add `@/` path alias (Vite `resolve.alias` + tsconfig `paths`) | Done | — |
| 14-R | Enforce import ordering (via `eslint-plugin-import-x`, ESLint-10-compatible) | Done | 14-Q |
| 14-S | Add `eslint-plugin-jsx-a11y` in `warn` mode | **Deferred** — no ESLint 10 support | — |
| 14-T | Fix the a11y backlog and promote jsx-a11y to `error` | **Deferred** — blocked by 14-S | 14-S |
| 14-U | Add a route/feature-root error boundary | Done | — |
| 14-V | Add a reusable inline-error/toast primitive | Done | — |
| 14-W | Server-state library ADR (decision, not code) | Done | — |

**Ordering notes.** 14-A is the foundation every CSS-Modules slice depends on (no component can reference `var(--space-*)` or import `clsx` until it lands). 14-B is the explicit **pattern-setter**: it establishes the module conventions (camelCase classes, `styles.*`, `clsx` for conditionals, `var(--…)` tokens) that 14-C…14-O copy verbatim — do it before any other component migration. The per-component slices (14-C…14-O) are otherwise independent of each other and can run in any order / in parallel, except where a parent renders a child whose rules co-mingle in `App.css` (14-I depends on 14-E's quick-capture work; 14-L depends on 14-K's tree; 14-N depends on 14-G + 14-H). **14-P is the closing slice** — it removes the last shell rules, deletes the emptied `App.css`, and drops the `import "./App.css"` line, so it depends on *all* component migrations. The tooling slices (14-Q…14-U), the toast primitive (14-V), and the ADR (14-W) are independent of the CSS migration and can land at any point; 14-R depends on 14-Q (the import plugin resolves the `@/` alias) and 14-T depends on 14-S (fix-then-promote).

---

## Slice 14-A — Foundation: token/global stylesheets, spacing scale, `clsx`

**Status:** Done

### Scenarios

```
Scenario: Tokens and themes load from the new stylesheet
  Given tokens.css holds the :root tokens and every [data-theme] block
  When  the app renders in the default theme and in each non-default theme
  Then  every screen looks identical to before the move (no reskin, no flash)

Scenario: The spacing scale exists and is referenceable
  Given tokens.css defines --space-1 … --space-6
  When  a module references var(--space-3)
  Then  it resolves to the defined value

Scenario: App.css no longer holds tokens, themes, reset, or base rules
  Given the foundation slice has landed
  Then  App.css contains no :root token block, no [data-theme] block, and no reset rule
  And   those rules now live in styles/tokens.css and styles/global.css

Scenario: clsx is available
  Given clsx is added as a dependency
  When  a module imports clsx
  Then  the build resolves it and the lock file is Node-20-compatible

Scenario: No FOUC regression
  Given a user with a non-default theme saved in localStorage
  When  they reload the app
  Then  no default-theme flash occurs before React mounts
```

### Acceptance criteria

- [ ] `web/src/styles/tokens.css` exists and holds the `:root` design tokens plus every `[data-theme]` block, moved verbatim from `App.css`
- [ ] A `--space-*` scale (at least `--space-1` … `--space-6`) is defined in `tokens.css`
- [ ] `web/src/styles/global.css` exists and holds the reset + bare-element base rules
- [ ] Both global stylesheets are imported exactly once at the app root, before `App.css`, preserving cascade order
- [ ] The moved blocks are deleted from `App.css` (no duplication)
- [ ] `clsx` is added to `web/` `dependencies`; `npm --prefix web run build` resolves it; lock file is Node-20-compatible
- [ ] No `var()` literals introduced; no hard-coded colour/radius/transition added
- [ ] The `index.html` anti-FOUC script is unchanged and still prevents the theme flash
- [ ] All existing component tests + relevant E2E journeys still green; no visual regression in any theme

---

## Slice 14-B — Pattern-setter: migrate `SignInPage` to a CSS Module

**Status:** Done

### Scenarios

```
Scenario: Sign-in page looks and behaves identically after migration
  Given SignInPage now uses a co-located CSS Module
  When  I view the sign-in screen
  Then  it looks identical to before and the sign-in button works as before

Scenario: App.css no longer contains the sign-in selectors
  Given the migration has landed
  Then  App.css contains no .sign-in-* or .google-mark selectors
  And   those rules live in SignInPage.module.css as camelCase classes

Scenario: The module follows the standard
  Given SignInPage.module.css
  Then  class names are camelCase, referenced via styles.* in the component
  And   every rule uses var(--…) tokens with no hard-coded colour/radius/transition
  And   every class in the module is referenced (no dead classes)
```

### Acceptance criteria

- [ ] `SignInPage`'s rules are moved into co-located `SignInPage.module.css`; nothing of its styling remains in `App.css`
- [ ] Class names are camelCase and referenced via `styles.*`; conditional classes use `clsx`
- [ ] Dead/migrated `sign-in-*` selectors removed from `App.css`
- [ ] No `var()` literal hard-coded colour/radius/transition/spacing introduced
- [ ] Every class in the module is referenced (no dead classes)
- [ ] `SignInPage.test.tsx` and the sign-in E2E journey still green; no visual regression
- [ ] This slice's PR description documents the established module pattern for later slices to follow

---

## Slice 14-C — Migrate `SessionExpiredBanner` + `ShortcutsPanel`

**Status:** Done

### Scenarios

```
Scenario: Session-expired banner looks and behaves identically
  Given SessionExpiredBanner uses a co-located module
  When  the session expires and the banner shows
  Then  it looks identical and "Sign in again" works as before

Scenario: Shortcuts panel looks and behaves identically
  Given ShortcutsPanel uses a co-located module
  When  I toggle the shortcuts panel open
  Then  it looks identical and toggles as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no shortcuts-* or session-banner selectors
```

### Acceptance criteria

- [ ] Both components' rules moved to co-located `*.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditionals
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `ShortcutsPanel.test.tsx`, `TokenRefresh.test.tsx`/`Auth.test.tsx` (banner) + relevant E2E still green; no visual regression

---

## Slice 14-D — Migrate `ThemePicker` + `FolderPicker`

**Status:** Done

### Scenarios

```
Scenario: Theme picker looks and behaves identically
  Given ThemePicker uses a co-located module
  When  I change the theme via the picker
  Then  it looks identical and the theme switches as before

Scenario: Folder picker looks and behaves identically
  Given FolderPicker uses a co-located module
  When  I open a note and change its folder via the picker
  Then  it looks identical and selects as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no theme-picker-* or folder-picker-* selectors
```

### Acceptance criteria

- [ ] Both components' rules moved to co-located `*.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditionals
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `ThemePicker.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-E — Migrate `TagFilter` + `QuickCaptureTodoInput`

**Status:** Done

### Scenarios

```
Scenario: Tag filter bar looks and behaves identically
  Given TagFilter uses a co-located module
  When  I filter the home list by tags
  Then  it looks identical and filtering works as before

Scenario: Quick-capture to-do input looks and behaves identically
  Given QuickCaptureTodoInput uses a co-located module
  When  I add a to-do from the home screen
  Then  the input looks identical and the optimistic add works as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no tag-filter-* or quick-capture-* selectors
```

### Acceptance criteria

- [ ] Both components' rules moved to co-located `*.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditionals (e.g. the filter mode toggle active state)
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `TagFilter.test.tsx`, `CollapsibleFilters.test.tsx`, `TodoSection.test.tsx` (quick-capture) + relevant E2E still green; no visual regression

---

## Slice 14-F — Migrate `NoteCard`

**Status:** Done

### Scenarios

```
Scenario: Note card looks and behaves identically
  Given NoteCard uses a co-located module
  When  I view the home list and interact with a card (open, delete affordance)
  Then  cards look identical and behave as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no note-card-* selectors
```

### Acceptance criteria

- [ ] `NoteCard`'s rules moved to co-located `NoteCard.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditionals
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `NoteCard.test.tsx`, `NoteCardDelete.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-G — Migrate `TagsSection` + `ActionsSection`

**Status:** Done

### Scenarios

```
Scenario: Tags section looks and behaves identically
  Given TagsSection uses a co-located module
  When  I add/remove tags and use the suggestions dropdown
  Then  it looks identical and behaves as before

Scenario: Actions section looks and behaves identically
  Given ActionsSection uses a co-located module
  When  I add, complete, and delete actions in a note
  Then  it looks identical and behaves as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no tags-section/tag-pill or actions-section selectors
```

### Acceptance criteria

- [ ] Both components' rules moved to co-located `*.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditional states (highlighted suggestion, completed action)
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `TagsSection.test.tsx`, `ActionsSection.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-H — Migrate `NoteEditor`

**Status:** Done

### Scenarios

```
Scenario: Note editor looks and behaves identically
  Given NoteEditor uses a co-located module
  When  I edit a note body and use the discussed/bubble controls
  Then  it looks identical and the editor behaves as before

Scenario: Tiptap vendor overrides remain effective and isolated
  Given any !important Tiptap override is kept in a labelled vendor block
  Then  the editor's rich-text formatting renders identically

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no note-editor-* or discussed-button selectors
```

### Acceptance criteria

- [ ] `NoteEditor`'s rules moved to co-located `NoteEditor.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditionals
- [ ] No `!important` in own styles; any Tiptap vendor override isolated in a clearly-labelled block
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] Editor-related tests + relevant E2E still green; no visual regression

---

## Slice 14-I — Migrate `TodoSection`

**Status:** Done

### Scenarios

```
Scenario: To Do panel looks and behaves identically
  Given TodoSection uses a co-located module
  When  I add, complete, reopen, and delete to-dos and toggle the Done section
  Then  it looks identical and all optimistic interactions behave as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no todo-section or done-section selectors
```

### Acceptance criteria

- [ ] `TodoSection`'s rules moved to co-located `TodoSection.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditional states (Done section collapsed/expanded, completed item)
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `TodoSection.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-J — Migrate `MeetingsSection`

**Status:** Done

### Scenarios

```
Scenario: Meetings panel looks and behaves identically
  Given MeetingsSection uses a co-located module
  When  I view today's meetings, create a note from a meeting, and see empty/error states
  Then  it looks identical and behaves as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no meetings-section/meeting-card selectors
```

### Acceptance criteria

- [ ] `MeetingsSection`'s rules moved to co-located `MeetingsSection.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditional states (empty, error, loading)
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `MeetingsSection.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-K — Migrate `FolderPreviewPanel` + `FolderTree`

**Status:** Done

### Scenarios

```
Scenario: Folder tree looks and behaves identically
  Given FolderTree uses a co-located module
  When  I expand/collapse folders and select a folder
  Then  it looks identical and navigates as before

Scenario: Folder preview panel looks and behaves identically
  Given FolderPreviewPanel uses a co-located module
  When  I open a folder's slide-out preview
  Then  it looks identical and behaves as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no folder-tree or folder-preview-* selectors
```

### Acceptance criteria

- [ ] Both components' rules moved to co-located `*.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditional states (expanded, selected, preview open)
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `FolderNavigation.test.tsx`, `FolderMutations.test.tsx`, `FolderPreview.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-L — Migrate `Sidebar`

**Status:** Done

### Scenarios

```
Scenario: Sidebar looks and behaves identically
  Given Sidebar uses a co-located module
  When  I open/close the sidebar and use the folders section
  Then  it looks identical and behaves as before

Scenario: App.css no longer contains the migrated sidebar selectors
  Then  App.css contains no sidebar folders-section selectors
```

### Acceptance criteria

- [ ] `Sidebar`'s rules moved to co-located `Sidebar.module.css`; nothing of its styling remains in `App.css` (outer shell rules deferred to 14-P are explicitly noted)
- [ ] camelCase classes via `styles.*`; `clsx` for conditional states (open/collapsed)
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `Sidebar.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-M — Migrate `ListView`

**Status:** Done

### Scenarios

```
Scenario: Home list view looks and behaves identically
  Given ListView uses a co-located module
  When  I view the home two-column layout, breadcrumb, and note cards
  Then  it looks identical and behaves as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no home-layout, breadcrumb, or note-summary-card selectors
```

### Acceptance criteria

- [ ] `ListView`'s rules moved to co-located `ListView.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditionals
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `ListView.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-N — Migrate `NoteView`

**Status:** Done

### Scenarios

```
Scenario: Note view looks and behaves identically
  Given NoteView uses a co-located module
  When  I open a note, see the header/date, the two-column layout, and save/delete status
  Then  it looks identical and the adaptive action buttons behave as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no note-header, back-button, or note-status selectors
```

### Acceptance criteria

- [ ] `NoteView`'s shell rules moved to co-located `NoteView.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditional button states (adaptive Cancel vs Save+Delete)
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `NoteView.test.tsx` + relevant E2E still green; no visual regression

---

## Slice 14-O — Migrate `TranscriptionPanel`

**Status:** Dropped — superseded by Phase 15-B, which deleted the `TranscriptionPanel` component entirely (replaced by the three-tab `TranscriptTab` note view). Its `App.css` rules were removed with the component, so there is nothing to migrate. PR #151 was closed unmerged.

### Scenarios

```
Scenario: Transcription panel looks and behaves identically
  Given TranscriptionPanel uses a co-located module
  When  I start/stop transcription and view the live transcript and controls
  Then  it looks identical and behaves as before

Scenario: App.css no longer contains the migrated selectors
  Then  App.css contains no transcription-panel selectors
```

### Acceptance criteria

- [ ] `TranscriptionPanel`'s rules moved to co-located `TranscriptionPanel.module.css`; nothing remains in `App.css`
- [ ] camelCase classes via `styles.*`; `clsx` for conditional states (recording, paused, error)
- [ ] Dead selectors removed from `App.css`
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes)
- [ ] `TranscriptionPanel.test.tsx` + relevant E2E still green; no visual regression (verify live capture controls in a real browser per the audio rule)

---

## Slice 14-P — Migrate `App.tsx` shell + notification banner; delete `App.css`

**Status:** Done

### Scenarios

```
Scenario: App shell looks and behaves identically
  Given the app shell uses a co-located module and App.css is gone
  When  I use the app (sidebar toggle, overlay, notifications, new-note CTA)
  Then  everything looks identical and behaves as before

Scenario: App.css is removed entirely
  Given every component now owns its styles in a module
  Then  web/src/App.css no longer exists
  And   App.tsx no longer imports "./App.css"
  And   the build succeeds with no missing-stylesheet error

Scenario: Reduced-motion preference still honoured
  Given a user with prefers-reduced-motion set
  Then  motion-reducing rules still apply (now from global.css)
```

### Acceptance criteria

- [ ] Outer-shell rules moved to `App.module.css`; the global `prefers-reduced-motion` rule lives in `global.css`
- [ ] `App.tsx` references `styles.*` and uses `clsx` for the overlay-open conditional
- [ ] `import "./App.css"` removed from `App.tsx`; `web/src/App.css` deleted
- [ ] No hard-coded colour/radius/transition/spacing literal
- [ ] Every class referenced (no dead classes); no `!important` in own styles
- [ ] `npm --prefix web run build` succeeds with no `App.css` present
- [ ] Full component suite + all E2E journeys green; full manual visual smoke across every theme confirms no regression

---

## Slice 14-Q — Add the `@/` path alias

**Status:** Done

### Scenarios

```
Scenario: The @/ alias resolves in the build and the type-checker
  Given vite.config and tsconfig define the @/ alias
  When  a module imports from "@/components/NoteCard"
  Then  the Vite build and tsc both resolve it

Scenario: Tests still resolve the alias
  Given Vitest shares the Vite config
  When  the test suite runs
  Then  aliased imports resolve and all tests pass
```

### Acceptance criteria

- [ ] `resolve.alias` in `vite.config.ts` maps `@` → `src`
- [ ] tsconfig `baseUrl` + `paths` map `@/*` → `src/*`
- [ ] At least one real import migrated to `@/…` compiles and runs
- [ ] `npm --prefix web run build` and `npm --prefix web test` pass (Vitest shares the Vite config so the alias resolves in tests)

---

## Slice 14-R — Add `eslint-plugin-import` and enforce import ordering

**Status:** Done — implemented with **`eslint-plugin-import-x`** (the ESLint-10-compatible fork) rather than `eslint-plugin-import`, which peer-caps at ESLint 9. Enabled `import-x/order` only; `import/no-unresolved` + `import/no-cycle` (also named in the original AC) were deferred — they need `eslint-import-resolver-typescript` wired for the `@/` alias and can be noisy on a first pass. See `technical-improvements.md`.

### Scenarios

```
Scenario: Import ordering is enforced
  Given eslint-plugin-import with import/order is configured
  When  a file orders imports incorrectly
  Then  npm --prefix web run lint reports it

Scenario: The existing codebase passes after the fix sweep
  Given the one-time --fix reorder has run
  When  lint runs over the repo
  Then  it reports zero import-order errors
```

### Acceptance criteria

- [ ] `eslint-plugin-import` added and registered in `web/eslint.config.js`
- [ ] `import/order` (builtin → external → internal) enforced; `no-unresolved`/`no-cycle` on; resolver understands the `@/` alias
- [ ] Lock file is Node-20-compatible
- [ ] Existing imports reordered to pass; `npm --prefix web run lint` is clean
- [ ] `npm --prefix web run build` + tests still green

---

## Slice 14-S — Add `eslint-plugin-jsx-a11y` in `warn` mode

**Status:** Deferred — `eslint-plugin-jsx-a11y@6.10.2` peer-caps at ESLint 9 and has no ESLint 10 support (the project is on ESLint 10). Forcing it via `--legacy-peer-deps` would risk the lint gate, so it is deferred until jsx-a11y ships ESLint 10 support. Tracked in `technical-improvements.md`.

### Scenarios

```
Scenario: jsx-a11y warnings surface without breaking the build
  Given eslint-plugin-jsx-a11y is configured at warn severity
  When  npm --prefix web run lint runs
  Then  a11y violations appear as warnings
  And   the lint step exits zero (CI does not fail on them yet)
```

### Acceptance criteria

- [ ] `eslint-plugin-jsx-a11y` added and registered in `web/eslint.config.js` at `warn` severity
- [ ] Lock file is Node-20-compatible
- [ ] `npm --prefix web run lint` surfaces the a11y backlog as warnings and still exits zero
- [ ] The PR notes the count of warnings to triage in 14-T

---

## Slice 14-T — Fix the a11y backlog and promote jsx-a11y to `error`

**Status:** Deferred — blocked by 14-S (jsx-a11y has no ESLint 10 support). Will follow once the plugin is installable.

### Scenarios

```
Scenario: The a11y backlog is cleared
  Given the jsx-a11y warnings from 14-S
  When  each is fixed (aria-labels, semantic elements, keyboard handlers)
  Then  npm --prefix web run lint reports zero a11y warnings

Scenario: a11y rules now gate the build
  Given the ruleset is promoted to error
  When  a new a11y violation is introduced
  Then  lint fails

Scenario: No behavioural regression from the fixes
  Given the a11y fixes are applied
  When  the component suite and E2E journeys run
  Then  they stay green
```

### Acceptance criteria

- [ ] Every `jsx-a11y` warning from 14-S is fixed (no rule disabled to silence it without justification)
- [ ] The ruleset is promoted from `warn` to `error` in `web/eslint.config.js`
- [ ] `npm --prefix web run lint` is clean at `error` severity
- [ ] Component tests + E2E journeys still green; no visual regression from the a11y fixes

---

## Slice 14-U — Add a route/feature-root error boundary

**Status:** Done

### Scenarios

```
Scenario: A crashing child renders the fallback, not a blank app
  Given a feature root wrapped in ErrorBoundary
  When  a child throws during render
  Then  the fallback UI is shown
  And   the rest of the app chrome remains usable
  And   the error is logged (not silently swallowed)

Scenario: Normal rendering is unaffected
  Given no child throws
  Then  the wrapped content renders exactly as before
```

### Acceptance criteria

- [ ] `ErrorBoundary.tsx` implements `getDerivedStateFromError` + `componentDidCatch`, renders a fallback, and logs the error
- [ ] Feature roots in `App.tsx` are wrapped in `<ErrorBoundary>`
- [ ] A new `ErrorBoundary.test.tsx` proves a throwing child renders the fallback
- [ ] No visual change to the happy path; full suite green
- [ ] Fallback uses a co-located CSS Module (per 14-A onward conventions) — no new `App.css` rules

---

## Slice 14-V — Add a reusable inline-error/toast primitive

**Status:** Done

### Scenarios

```
Scenario: A failed optimistic mutation surfaces a visible error
  Given an optimistic mutation handler wired to the toast primitive
  When  the underlying API call fails
  Then  the local change is rolled back
  And   a visible, accessible error is shown (role=alert / aria-live)
  And   the user can retry

Scenario: The toast is accessible and auto-dismisses (or is dismissible)
  Given a toast is shown
  Then  it is announced to assistive tech
  And   it can be dismissed (or auto-dismisses) without blocking interaction
```

### Acceptance criteria

- [ ] A reusable, accessible error primitive exists with a co-located CSS Module (`role="alert"`/`aria-live`)
- [ ] At least one existing optimistic handler surfaces failures through it (reference integration)
- [ ] A new `Toast.test.tsx` (or `InlineError.test.tsx`) covers show + dismiss + the failure-surface path
- [ ] No hard-coded colour/radius/transition/spacing literal; every class referenced
- [ ] Full suite green; no visual regression to the happy path

---

## Slice 14-W — Server-state library ADR (decision, not code)

**Status:** Done

### Scenarios

```
Scenario: The server-state strategy is recorded
  Given the ADR is written
  Then  it states the decision (adopt a library + incremental migration, or stay hand-rolled with reasons)
  And   it weighs TanStack Query / SWR / hand-rolled
  And   the technical-improvements item is closed pointing at it

Scenario: No code change ships in this slice
  Given the ADR slice
  Then  no server-state library is added as a dependency
  And   no existing data hook is rewritten
```

### Acceptance criteria

- [ ] An ADR under `docs/adr/` records the server-state decision with options, decision, and consequences
- [ ] The "Decide on a server-state library" technical-improvements item is marked Done / repointed at the ADR
- [ ] No frontend dependency added and no data hook rewritten in this slice
- [ ] If "adopt" is chosen, the ADR notes that the migration graduates to its own future phase
