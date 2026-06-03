# Phase 14 — Frontend standards alignment — CSS Modules migration & tooling

**Goal:** Bring the `web/` frontend in line with the rewritten frontend standards (the `frontend-react` skill + `docs/react-coding-standards.md`). This is a **refactor/migration phase** — **no new user-facing behaviour, no backend changes, no event-model changes**. Every slice is structural: retire the single 2,816-line global `web/src/App.css` in favour of co-located CSS Modules, extract design tokens and a new `--space-*` scale into `styles/tokens.css` + `styles/global.css`, add the tooling the standards now mandate (`clsx`, `@/` path alias, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`), and add an error boundary. The acceptance bar for every slice is **"structure now matches the standard AND no visual or behavioural regression."** The existing Vitest/RTL component suite (25 files in `web/src/__tests__/`) and the Playwright (C#) `Browser.E2E` journeys are the regression net — they must stay green through every slice, and a manual visual smoke confirms no reskin.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 14-A | Foundation: `styles/tokens.css` + `styles/global.css`, `--space-*` scale, `clsx` dep, wire global imports | Done | — |
| 14-B | Pattern-setter migration: `SignInPage` → CSS Module (establishes the conventions the rest copy) | Done | 14-A |
| 14-C | Migrate `SessionExpiredBanner` + `ShortcutsPanel` (leaf, self-contained) | Done | 14-B |
| 14-D | Migrate `ThemePicker` + `FolderPicker` (small selects) | Done | 14-B |
| 14-E | Migrate `TagFilter` + `QuickCaptureTodoInput` (leaf inputs) | In Progress | 14-B |
| 14-F | Migrate `NoteCard` (home list card) | Not Started | 14-B |
| 14-G | Migrate `TagsSection` + `ActionsSection` (note-view right panel) | Not Started | 14-B |
| 14-H | Migrate `NoteEditor` (editor container + discussed button) | Not Started | 14-B |
| 14-I | Migrate `TodoSection` (todo + done + quick-capture sections) | Not Started | 14-B, 14-E |
| 14-J | Migrate `MeetingsSection` (meetings list + meeting card + status states) | Not Started | 14-B |
| 14-K | Migrate `FolderPreviewPanel` + `FolderTree` (folder tree + slide-out preview) | Not Started | 14-B |
| 14-L | Migrate `Sidebar` (folders section + app-shell sidebar chrome) | Not Started | 14-B, 14-K |
| 14-M | Migrate `ListView` (home two-column layout, breadcrumb, summary cards) | Not Started | 14-B |
| 14-N | Migrate `NoteView` (note header, two-column layout, status messages) | Not Started | 14-B, 14-G, 14-H |
| 14-O | Migrate `TranscriptionPanel` (the large transcription block, ~L2347–2670) | Not Started | 14-B |
| 14-P | Migrate `App.tsx` shell + notification banner; remove the now-empty `App.css` and its import | Not Started | 14-B…14-O |
| 14-Q | Add `@/` path alias (Vite `resolve.alias` + tsconfig `paths`) | Done | — |
| 14-R | Add `eslint-plugin-import` + enforce import ordering | Not Started | 14-Q |
| 14-S | Add `eslint-plugin-jsx-a11y` in `warn` mode | Not Started | — |
| 14-T | Fix the a11y backlog and promote jsx-a11y to `error` | Not Started | 14-S |
| 14-U | Add a route/feature-root error boundary | Done | — |
| 14-V | Add a reusable inline-error/toast primitive | In Progress | — |
| 14-W | Server-state library ADR (decision, not code) | Done | — |

**Ordering notes.** 14-A is the foundation every CSS-Modules slice depends on (no component can reference `var(--space-*)` or import `clsx` until it lands). 14-B is the explicit **pattern-setter**: it establishes the module conventions (camelCase classes, `styles.*`, `clsx` for conditionals, `var(--…)` tokens) that 14-C…14-O copy verbatim — do it before any other component migration. The per-component slices (14-C…14-O) are otherwise independent of each other and can run in any order / in parallel, except where a parent renders a child whose rules co-mingle in `App.css` (14-I depends on 14-E's quick-capture work; 14-L depends on 14-K's tree; 14-N depends on 14-G + 14-H). **14-P is the closing slice** — it removes the last shell rules, deletes the emptied `App.css`, and drops the `import "./App.css"` line, so it depends on *all* component migrations. The tooling slices (14-Q…14-U), the toast primitive (14-V), and the ADR (14-W) are independent of the CSS migration and can land at any point; 14-R depends on 14-Q (the import plugin resolves the `@/` alias) and 14-T depends on 14-S (fix-then-promote).

**Learning surface:** CSS Modules scoping and the `*.module.css` co-location model; designing a design-token + `--space-*` spacing system and migrating a global stylesheet onto it; performing a large incremental refactor safely under a regression net (component tests + E2E journeys as the safety harness); authoring ESLint flat-config plugins (`eslint-plugin-import`, `eslint-plugin-jsx-a11y`) and a `warn`→fix→`error` rollout; path-alias resolution across Vite + tsconfig; React error boundaries; and recording an architecture decision (server-state strategy) as an ADR.

---

## Slice 14-A — Foundation: token/global stylesheets, spacing scale, `clsx`

**Status:** Done

**Value:** Establishes the structural target every later slice builds on: the two canonical global stylesheets (`styles/tokens.css`, `styles/global.css`), a brand-new `--space-*` spacing scale, and the `clsx` dependency. After this slice, `App.css` holds only component rules — its `:root` tokens, every `[data-theme]` block, and the reset/base-element rules have moved out. Zero visual change: the same cascade, the same tokens, just relocated.

**Backend changes:** None.

### Key implementation files

- `web/src/styles/tokens.css` — **new**; move the `/* ── Design tokens ── */` `:root` block (App.css ~L1–24) and every `[data-theme]` block (the `/* ── Light themes ── */` ~L25–162 and `/* ── Dark themes ── */` ~L163–242 sections) here verbatim. Add a `--space-*` scale (e.g. `--space-1: 4px` … `--space-6: 48px`) to the `:root` block.
- `web/src/styles/global.css` — **new**; move the `/* ── Reset ── */` block (App.css ~L243–257) and any bare-element base rules (`body`, `a`, `button` defaults, `/* ── Layout ── */` ~L441–454, `/* ── Typography ── */` ~L455–463) here.
- `web/src/main.tsx` (or `App.tsx`) — import `./styles/tokens.css` and `./styles/global.css` once at the app root, **before** the existing `./App.css` import so the cascade order is preserved.
- `web/src/App.css` — delete the moved token/theme/reset/base blocks; the file now starts at the component sections.
- `web/package.json` — add `clsx` to `dependencies` (verify Node 20 / CI lock-file parity per the CLAUDE.md guardrail before committing `package-lock.json`).
- `web/index.html` — **do not change** the anti-FOUC inline script; the theme names it hardcodes are unchanged by this move. (Confirm it still works after relocation.)

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

**Value:** The first component migration, chosen deliberately as the **convention-setter**. `SignInPage` is a self-contained leaf (the sign-in region, App.css ~L2347 / the `/* ── end CHANGE-5 sign-in region ── */` banner ~L2673) with no children sharing its rules, so it is a clean canvas to establish the exact module pattern every later slice copies: `import styles from "./SignInPage.module.css"`, camelCase class names, `styles.*` in JSX, `clsx` for any conditional class, `var(--…)` tokens (including `--space-*`) throughout, and deletion of the migrated selectors from `App.css`. The slice's notes call out the pattern explicitly so 14-C…14-O have a worked reference.

**Backend changes:** None.

### Key implementation files

- `web/src/components/SignInPage.module.css` — **new**; the `sign-in-*` and `google-mark` rules from `App.css`, classes converted to camelCase (`signInPage`, `signInCard`, `signInBadge`, `signInTitle`, `signInTagline`, `signInButton`, `googleMark`).
- `web/src/components/SignInPage.tsx` — swap the `className="sign-in-…"` strings to `styles.*`; use `clsx` for any conditional class.
- `web/src/App.css` — delete the migrated `sign-in-*` / sign-in-region selectors.

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

**Value:** Two small, self-contained leaf components migrated together. `SessionExpiredBanner` is a full-screen overlay; `ShortcutsPanel` is a toggle + table. Neither shares rules with other components, so grouping them keeps the diff thin while clearing two more `App.css` sections (`/* ── Shortcuts panel ── */` ~L865–927; the banner's overlay rules).

**Backend changes:** None.

### Key implementation files

- `web/src/components/SessionExpiredBanner.module.css` + `.tsx`
- `web/src/components/ShortcutsPanel.module.css` + `.tsx` (`shortcutsPanel`, `shortcutsToggle`, `shortcutsTable`)
- `web/src/App.css` — delete the migrated selectors.

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

**Value:** Two tiny select-based controls migrated together. `ThemePicker` (theme dropdown) and `FolderPicker` (note-view folder select) are both small, leaf, label+select widgets — trivially grouped. Clears `/* ── Folder picker ── */` ~L2075–2110 and the theme-picker rules.

**Backend changes:** None.

### Key implementation files

- `web/src/components/ThemePicker.module.css` + `.tsx` (`themePicker`, `themePickerLabel`, `themePickerSelect`)
- `web/src/components/FolderPicker.module.css` + `.tsx` (`folderPickerSection`, `folderPickerHeading`, `folderPickerSelect`)
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** In Progress

**Value:** Two leaf input/pill controls. `TagFilter` is the home-screen tag filter bar (`/* ── Tag filter bar ── */` ~L1624–1715); `QuickCaptureTodoInput` is the to-do quick-add input (`/* ── Quick-capture input ── */` ~L1224–1292). Migrating the quick-capture input here clears the way for `TodoSection` (14-I), which renders it.

**Backend changes:** None.

### Key implementation files

- `web/src/components/TagFilter.module.css` + `.tsx` (`tagFilter`, `tagFilterPills`, `tagFilterControls`, `tagFilterModeToggle`, `tagFilterClear`)
- `web/src/components/QuickCaptureTodoInput.module.css` + `.tsx` (`quickCaptureInput`, `quickCaptureError`)
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The home-screen note card (`/* ── Note card tags ── */` ~L1603–1623 plus its `note-card-*` block and any note-summary-card rules it owns). A single focused component with rich internal structure (header, title, date, snippet, tags, action row) — a good standalone slice.

**Backend changes:** None.

### Key implementation files

- `web/src/components/NoteCard.module.css` + `.tsx` (`noteCard`, `noteCardHeader`, `noteCardTitle`, `noteCardDate`, `noteCardSnippet`, `noteCardTags`, `noteCardTagPill`, `noteCardActionsRow`)
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The two right-panel note-view sections, tightly co-located in the layout. `TagsSection` (`/* ── Tags section ── */` ~L1472–1602) and `ActionsSection` (`/* ── Actions section ── */` ~L982–1085) sit side by side in the note view and share its panel grid, so migrating them together keeps the layout coherent. `NoteView` (14-N) depends on both being done.

**Backend changes:** None.

### Key implementation files

- `web/src/components/TagsSection.module.css` + `.tsx` (`tagsSection`, `tagsHeading`, `tagsPills`, `tagPill`, `tagPillRemove`, `tagsInputWrapper`, `tagsInput`, `tagSuggestions`)
- `web/src/components/ActionsSection.module.css` + `.tsx` (`actionsSection`, `actionsHeading`, `empty`, `actionsList`, `actionCheckbox`, `deleteActionButton`, `actionInput`)
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The note editor container and "discussed" button (`/* ── Editor container + discussed button ── */` ~L928–981, plus `/* ── Note editor ── */` ~L761–830). Note the Tiptap vendor-override carve-out: any `!important` overriding Tiptap's injected styles must stay isolated in a clearly-labelled block (the one sanctioned `!important` exception per the standard) rather than scattered.

**Backend changes:** None.

### Key implementation files

- `web/src/components/NoteEditor.module.css` + `.tsx` (`noteEditorContainer`, `discussedButton`; isolate any Tiptap vendor overrides in a labelled block)
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The home-screen To Do panel: open list, the collapsible Done section, and reopen/delete affordances (`/* ── Todo section ── */` ~L1086–1186 and `/* ── Done section ── */` ~L1187–1223). It renders `QuickCaptureTodoInput`, whose styles are migrated in 14-E, so this slice can reference the already-modular child cleanly.

**Backend changes:** None.

### Key implementation files

- `web/src/components/TodoSection.module.css` + `.tsx`
- `web/src/App.css` — delete the migrated `todo-section` / `done-section` selectors.

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

**Status:** Not Started

**Value:** Today's Meetings panel: the section, the bordered meeting card, and its empty/error status states (`/* ── Meetings section ── */` ~L2142–2164, `/* ── Meeting card ── */` ~L2165–2242, `/* ── Meetings status states ── */` ~L2243–2280). One focused, self-contained feature panel.

**Backend changes:** None.

### Key implementation files

- `web/src/components/MeetingsSection.module.css` + `.tsx`
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The folder tree and its slide-out preview, which share the folder-navigation visual language (`/* ── Folder tree ── */` ~L1846–1969, `/* ── Folder preview panel ── */` ~L1970–2074). `FolderTree` is a child of `Sidebar`; doing the tree here lets `Sidebar` (14-L) reference the already-modular tree.

**Backend changes:** None.

### Key implementation files

- `web/src/components/FolderTree.module.css` + `.tsx`
- `web/src/components/FolderPreviewPanel.module.css` + `.tsx` (`folderPreviewHeader`, `folderPreviewTitle`, `folderPreviewClose`, `folderPreviewList`, `folderPreviewEmpty`, `folderPreviewItem`, `folderPreviewNoteTitle`, `folderPreviewNoteDate`)
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The sidebar chrome and its folders section (`/* ── Sidebar folders section ── */` ~L1739–1845, plus the sidebar-specific parts of `/* ── App shell ── */` ~L258–440 that belong to the sidebar element rather than the outer layout). Done after 14-K so the folder tree it contains is already modular; the outer `app-layout`/`app-main`/overlay shell rules stay for 14-P.

**Backend changes:** None.

### Key implementation files

- `web/src/components/Sidebar.module.css` + `.tsx`
- `web/src/App.css` — delete the migrated sidebar selectors (leave the outer `app-layout`/`sidebar-toggle`/`sidebar-overlay` shell rules for 14-P unless they belong cleanly to `Sidebar`).

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

**Status:** Not Started

**Value:** The home two-column layout, the ListView folder breadcrumb, and the note-summary cards it lays out (`/* ── Home two-column layout ── */` ~L2111–2141, `/* ── Folder breadcrumb in ListView ── */` ~L1716–1738, `/* ── Note summary cards ── */` ~L1293–1471). `NoteCard` is already modular (14-F); this slice owns the surrounding list/grid layout.

**Backend changes:** None.

### Key implementation files

- `web/src/components/ListView.module.css` + `.tsx`
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The note-view shell: header (back + delete row), header date, the two-column note layout, and the note-view status messages (`/* ── Back button ── */` ~L544–571, `/* ── Note header ── */` ~L572–719, `/* ── Note header date ── */` ~L720–760, `/* ── Note two-column layout ── */` ~L831–864, `/* ── Status messages ── */` ~L492–543). Done after its panel children (`TagsSection`/`ActionsSection` in 14-G, `NoteEditor` in 14-H) so only the surrounding shell remains.

**Backend changes:** None.

### Key implementation files

- `web/src/components/NoteView.module.css` + `.tsx`
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The single largest section in `App.css` — the transcription UI (`/* ── Transcription panel ── */` ~L2347–2670, ~320 lines). Isolated as its own slice precisely because of its size; it's a self-contained feature panel with no shared rules.

**Backend changes:** None.

### Key implementation files

- `web/src/components/TranscriptionPanel.module.css` + `.tsx`
- `web/src/App.css` — delete the migrated selectors.

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

**Status:** Not Started

**Value:** The closing slice. Migrates the remaining outer-shell rules — `app-layout`, `app-main`, `sidebar-toggle`, `sidebar-overlay` (`/* ── App shell ── */` ~L258–440) and the global `/* ── Notification banner ── */` (~L2281–2338) and `/* ── New Note button (CTA) ── */` (~L464–491) and `/* ── Reduced motion ── */` (~L2339–2346) — into `App.module.css` (or `global.css` for the genuinely global `prefers-reduced-motion` rule), then **deletes the now-empty `App.css` and removes its `import "./App.css"` line from `App.tsx`.** Depends on every earlier component migration: it can only land once `App.css` holds nothing but shell rules.

**Backend changes:** None.

### Key implementation files

- `web/src/App.module.css` — **new**; the outer-shell rules (`appLayout`, `appMain`, `sidebarToggle`, `sidebarOverlay`, `newNoteButton`, notification-banner rules).
- `web/src/App.tsx` — swap `className="app-layout"`/`"sidebar-toggle"`/`"sidebar-overlay"` to `styles.*`; use `clsx` for the `sidebar-overlay--open` conditional; **remove `import "./App.css"`** and add `import styles from "./App.module.css"`.
- `web/src/styles/global.css` — move the genuinely-global `prefers-reduced-motion` rule here if it isn't component-scoped.
- `web/src/App.css` — **delete the file** once empty.

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

**Value:** Replace deep `../../..` relative-import chains with an `@/` alias, as the broader-conventions table requires. Independent of the CSS migration. Pairs with 14-R (the import plugin's resolver uses the alias).

**Backend changes:** None.

### Key implementation files

- `web/vite.config.ts` — add `resolve.alias` mapping `@` → `web/src`.
- `web/tsconfig.app.json` (and/or `tsconfig.json`) — add `baseUrl` + `paths` so `@/*` resolves to `src/*`.
- Optionally migrate a few representative deep imports to `@/…` to prove the alias (full sweep is opportunistic per the standard).

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

**Status:** Not Started

**Value:** Machine-enforce the builtin → external → internal import ordering the standards describe, and catch unresolved/circular imports. Depends on 14-Q so the resolver understands the `@/` alias.

**Backend changes:** None.

### Key implementation files

- `web/package.json` — add `eslint-plugin-import` (+ `eslint-import-resolver-typescript` if needed for alias resolution).
- `web/eslint.config.js` — register the plugin in the flat config; enable `import/order` (builtin → external → internal) and `import/no-unresolved` / `import/no-cycle`; configure the resolver for the `@/` alias.
- Reorder existing imports flagged by the new rule (a one-time `--fix` sweep).

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

**Status:** Not Started

**Value:** Introduce machine-enforced accessibility linting, but **non-blocking first** so the existing backlog of warnings is surfaced and quantified before it gates the build. Independent of the CSS migration. The fix-and-promote step is 14-T.

**Backend changes:** None.

### Key implementation files

- `web/package.json` — add `eslint-plugin-jsx-a11y`.
- `web/eslint.config.js` — register the plugin; enable its recommended ruleset at `warn` severity.

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

**Status:** Not Started

**Value:** Clear every `jsx-a11y` warning surfaced in 14-S, then promote the ruleset to `error` so accessibility regressions fail the build. Depends on 14-S. (If the backlog turns out small, 14-S and 14-T could merge — but they are split here to keep each diff thin, per the "if a slice's diff would be large, split it" rule.)

**Backend changes:** None.

### Key implementation files

- The components flagged by `jsx-a11y` (likely icon-only buttons missing `aria-label`, static-element interactions) — `icons.tsx` consumers, affordance buttons in `NoteCard`/`TodoSection`/`MeetingsSection`, etc.
- `web/eslint.config.js` — flip the `jsx-a11y` ruleset from `warn` to `error`.

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

**Value:** The broader-conventions table requires wrapping route/feature roots in an error boundary so one component crash doesn't blank the whole app. None exists today (verified). A thin slice adding a single reusable `ErrorBoundary` and wrapping the app's feature roots.

**Backend changes:** None.

### Key implementation files

- `web/src/components/ErrorBoundary.tsx` — **new**; a class component implementing `getDerivedStateFromError` + `componentDidCatch` (the one sanctioned class component, since error boundaries require it), rendering a fallback UI and logging the error (no silent swallow).
- `web/src/App.tsx` (and/or `main.tsx`) — wrap the feature roots (e.g. `NoteView`, `ListView`, the main content region) in `<ErrorBoundary>`.
- `web/src/__tests__/ErrorBoundary.test.tsx` — **new**; a component that throws is caught and the fallback renders.

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

**Status:** In Progress

**Value:** The new optimistic-failure rule (`frontend-react` skill) requires surfacing a failed mutation to the user — undo the local change *and* show the failure — but the only error UI today is the full-screen `SessionExpiredBanner`. The skill explicitly names "a reusable inline-error/toast component" as a known gap. This slice adds a small, reusable primitive (a transient toast or an inline-error slot) that mutation handlers can call to surface a failure, replacing the "nearest available mechanism" stopgap. **Included** in-scope: it's a thin, self-contained primitive with no backend, and it directly unblocks the mandated optimistic-failure UX that the rest of the app currently can't satisfy cleanly.

**Backend changes:** None.

### Key implementation files

- `web/src/components/Toast.tsx` (or `InlineError.tsx`) + co-located `*.module.css` — **new**; a reusable, accessible (`role="alert"`/`aria-live`) transient error surface.
- A lightweight provider/hook (e.g. `useToast`) if a global toast model is chosen, under `web/src/hooks/`.
- Wire it into **one** existing optimistic handler as the reference integration (e.g. the home-screen to-do add or note delete failure path), leaving wholesale adoption to opportunistic follow-up.
- `web/src/__tests__/Toast.test.tsx` — **new**.

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

**Value:** The standards are silent on how the frontend manages *server state* (cached server-owned data: notes, folders, action items), which reads as unconsidered. This slice lands a short **ADR** that records a conscious decision — adopt TanStack Query / SWR and migrate hooks incrementally, **or** deliberately stay hand-rolled because this is a learning vehicle — with the rationale. **This is a DECISION, not a migration:** no TanStack-Query code, no hook rewrites. (A migration, if chosen, graduates to its own future phase.) Included as a single ADR slice rather than left out, because the decision is small, self-contained, and unblocks every future server-state choice.

**Backend changes:** None.

### Key implementation files

- `docs/adr/00NN-server-state-strategy.md` — **new**; the ADR (context, options weighed — TanStack Query vs SWR vs hand-rolled, decision, consequences). Number it after the latest existing ADR.
- `docs/technical-improvements.md` — mark the "Decide on a server-state library" item Done (or update it to point at the ADR), per the standing-doc lifecycle.
- `docs/react-coding-standards.md` / `frontend-react` skill — optionally add a one-line pointer to the ADR so the strategy is discoverable.

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

---

## Observability

**No new silent failure modes.** This is a pure frontend refactor: CSS Modules migration, tokenisation, ESLint tooling, a path alias, and documentation. It adds no new network calls, no backend, no event-model change, and no new async flow — so there is nothing new to instrument in production logs/traces/metrics. The dominant risk is **visual or behavioural regression** (a dropped/renamed selector, a lost cascade rule, a broken theme), which is mitigated by the existing Vitest/RTL component suite, the Playwright (C#) `Browser.E2E` journeys, and a manual visual smoke across every theme — the acceptance gate on every migration slice.

**Exceptions / slices that change runtime behaviour:**
- **14-U (error boundary)** introduces a new runtime path — a caught render crash now renders a fallback instead of bubbling. Its acceptance criteria require the boundary to **log** the caught error (no silent swallow), so a production crash that was previously an uncaught blank-screen becomes a logged, observable event. This is a net observability *improvement*, not a gap.
- **14-V (toast primitive)** makes previously-silent optimistic-failure rollbacks **visible to the user** (`role="alert"`). It surfaces failures in the UI rather than in telemetry; no new server-side instrumentation is needed, but it closes a user-facing silent-failure gap the standards flag.

No instrumentation slice is required for this phase.
