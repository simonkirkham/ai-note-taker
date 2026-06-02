# Phase Minor Changes — Tweaks backlog

**Goal:** A standing, unnumbered phase that captures small tweaks and changes that aren't worth a numbered phase of their own and aren't defects. Like the bugs phase, it has no learning theme and no fixed slice sequence — items are added as they surface and marked Done as they ship. Each change still goes through the normal pipeline: a spec/test where behaviour changes, then the change.

**What belongs here:** small, self-contained adjustments to existing behaviour or appearance — a copy change, a default tweaked, a control relabelled, a spacing fix. If it introduces genuinely new user-facing capability it's a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase). If it's a defect, it's a **bug** ([docs/phases/phase-bugs.md](phase-bugs.md)). If it's a refactor, upgrade, or CI/infra item, it's a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** none specific — this is polish and maintenance work.

---

## Summary

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| CHANGE-1 | Single-spaced note lines by default | Done | — |
| CHANGE-2 | Theme selection (Teal / Forest / Midnight) | Done | — |
| CHANGE-3 | Home screen shows today's notes by default | Done | — |
| CHANGE-4 | To-do rows wrap cleanly with long text + note title | Done | — |
| CHANGE-5 | Sign-in screen visual polish | In Progress | — |
| CHANGE-6 | Collapsible "Filters" control for home tags | In Progress | — |
| CHANGE-7 | More colour schemes; drop duplicate Forest theme | In Progress | CHANGE-2 (shipped) |

Tweaks are appended here as they are identified. Use the same per-item format: a short title, **Status**, value/symptom, and acceptance criteria (with scenarios and approach where the change warrants them).

CHANGE-1 to CHANGE-4 were moved here from the former "Phase 13 — UI Polish II" once it was clear they were minor tweaks rather than a distinct phase.

---

## CHANGE-1 — Single-spaced note lines by default

**Status:** ✅ Done — PR #98, deployed 2026-06-02. See [docs/learnings/phase-minor-1-single-spaced-lines.md](../learnings/phase-minor-1-single-spaced-lines.md).

**Value:** Pressing Enter in the note editor currently leaves a full blank line between paragraphs, so notes look double-spaced and waste vertical space. Each `Enter` creates a new ProseMirror `<p>`, and with no paragraph-margin override the browser's default `p { margin: 1em 0 }` — compounded by the editor's `line-height: 1.75` — renders a visible blank line between every block. Notes should read as single-spaced by default: consecutive lines sit directly beneath one another, the way a meeting scratchpad does.

**Backend changes:** None. This is a pure styling change to how the editor's paragraphs render. Markdown storage is unaffected — paragraphs are still distinct blocks in the serialised markdown; only their on-screen vertical gap changes.

---

### Approach

Keep the existing block model — `Enter` still creates a new paragraph, so headings, lists, and checkboxes continue to behave exactly as today. The only change is visual: collapse the inter-paragraph gap so paragraphs are single-spaced.

Add a paragraph-margin override scoped to the editor content so it cannot leak into other screens:

```css
.content-input p {
  margin: 0;
}
```

`line-height: 1.75` on `.content-input` already provides comfortable in-paragraph leading; removing the block margin is what eliminates the double-spaced appearance. Headings, lists, and other block nodes keep their existing spacing — this rule targets paragraphs only. If headings end up too tight against the preceding paragraph once the gap is gone, add a small `margin-top` to `.content-input h1, .content-input h2, .content-input h3` rather than reintroducing paragraph margins.

**Why CSS, not a keymap change:** an alternative is to remap `Enter` to a hard line break (`<br>`) so everything lives in one paragraph. That changes markdown serialisation (line breaks instead of paragraph breaks) and the meaning of stored content, and it would break the heading/list semantics the editor relies on. The styling fix achieves the requested single-spaced look with zero impact on the event payload or the editor's structural behaviour, so it is the preferred approach.

---

### Key implementation files

- `web/src/App.css` — add a `.content-input p { margin: 0; }` rule (and, if needed, a small top margin on editor headings) in the editor styles block near the existing `.content-input` rules (~line 519)

No `.tsx` changes are expected. `NoteEditor.tsx` and its StarterKit configuration are untouched.

---

### Scenarios

```
Scenario: Pressing Enter produces single-spaced lines
  Given I am editing a note with the content "First line"
  When  I press Enter and type "Second line"
  Then  "Second line" appears directly beneath "First line" with no blank line between them

Scenario: Existing multi-paragraph notes render single-spaced
  Given a note whose stored markdown has several paragraphs
  When  I open the note
  Then  the paragraphs render single-spaced, with no blank line between consecutive paragraphs

Scenario: Markdown content is unchanged by the spacing fix
  Given I type two lines separated by Enter
  When  the note is saved
  Then  the stored markdown still represents two distinct paragraphs (the change is visual only)

Scenario: Headings and lists keep their own spacing
  Given a note containing a heading followed by a paragraph and a bullet list
  When  I view the note
  Then  the heading and list remain visually distinct from surrounding paragraphs
  And   only the paragraph-to-paragraph gap is collapsed
```

---

### Acceptance criteria

- [ ] Consecutive paragraphs in the note editor render single-spaced — no blank line between them
- [ ] The override is scoped to `.content-input` so it does not affect paragraph spacing elsewhere in the app
- [ ] Headings, bullet lists, and checkboxes retain readable spacing and remain visually distinct from adjacent paragraphs
- [ ] Markdown serialisation is unchanged — paragraphs are still stored as separate blocks; no new event shape
- [ ] In-paragraph leading (`line-height: 1.75`) is preserved
- [ ] Existing `NoteEditor` / `NoteView` component tests remain green

---

## CHANGE-2 — Theme selection

**Status:** ✅ Done — PR #102, deployed 2026-06-02. See [docs/learnings/phase-minor-2-theme-selection.md](../learnings/phase-minor-2-theme-selection.md).

**Value:** Users can choose a colour theme for the app. The whole UI already draws every colour from CSS custom properties on `:root` (`--color-primary`, `--color-bg`, `--color-text`, `--color-cta`, `--color-border`, etc.), so theming is a matter of overriding those variables and remembering the choice. This change ships three themes — the current **Teal** (default), **Forest** (deeper emerald, light), and **Midnight** (full dark mode) — selectable from a small picker in the sidebar footer and persisted across sessions.

**Backend changes:** None. Theme preference is a pure client concern stored in `localStorage`; it is not part of the event model or any projection.

---

### Chosen themes

| Theme | Primary | Primary-dark | CTA | Background | Surface | Text | Text-muted | Border |
|-------|---------|--------------|-----|------------|---------|------|-----------|--------|
| **Teal** *(default)* | `#0D9488` | `#0F766E` | `#F97316` | `#F0FDFA` | `#FFFFFF` | `#134E4A` | `#64748B` | `#CCEBE8` |
| **Forest** | `#059669` | `#047857` | `#F97316` | `#ECFDF5` | `#FFFFFF` | `#064E3B` | `#64748B` | `#BBF7D0` |
| **Midnight** | `#2DD4BF` | `#14B8A6` | `#FB923C` | `#0F172A` | `#1E293B` | `#E2E8F0` | `#94A3B8` | `#334155` |

`--color-primary-bg` follows the primary at ~6% opacity (light themes) / ~10% (Midnight); `--color-cta-dark` is the CTA one step darker. Teal remains the `:root` default so any code path that never sets a theme is unchanged.

---

### Mechanism

1. **Palettes as `data-theme` overrides.** Keep the current Teal palette on `:root`. Add `[data-theme="forest"] { … }` and `[data-theme="midnight"] { … }` blocks in `App.css` that re-declare the same custom properties. Setting `document.documentElement.dataset.theme = "forest"` swaps the whole palette through the existing cascade — no component touches a literal colour.
2. **Persistence.** Store the choice under a `localStorage` key (`note-taker-theme`). Valid values: `teal` | `forest` | `midnight`; anything else falls back to `teal`.
3. **No flash of default theme.** A tiny inline bootstrap script in `index.html` reads `localStorage` and sets `data-theme` on `<html>` *before* React mounts, so a Midnight user never sees a Teal flash on load.
4. **React state.** A `useTheme` hook (or small `ThemeContext`) exposes `theme` and `setTheme(t)`. `setTheme` writes `localStorage` and updates `document.documentElement.dataset.theme`. The sidebar picker calls `setTheme`.
5. **Sidebar picker.** A small labelled control in the sidebar footer, directly above the existing **Sign out** button (the established footer slot). A native `<select>` with three options keeps it accessible and tiny; label "Theme".

---

### Dark-mode audit (Midnight)

Most colours are variables and flip automatically, but a grep of `App.css` turns up a handful of **hardcoded light backgrounds** that would render as bright patches in Midnight and must be converted to variables (or given `[data-theme="midnight"]` overrides) as part of this change:

- `.notification-banner-enable` — `background: #fff` (~L2057)
- `.todo-delete-btn` — `background: #FEF2F2` (~L882)
- `.transcription-error` — `background: #fee2e2` (~L2177)
- `.transcription-stop-button:hover` — `background: #fee2e2` (~L2220)

Recommended fix: introduce semantic tokens (`--color-error`, `--color-error-bg`, `--color-surface-alt`) declared per theme, and replace these literals. `color: #fff` on coloured buttons (primary/CTA) is fine in every theme and needs no change. Pure-black shadow `rgba(0,0,0,…)` values read acceptably on dark backgrounds and are out of scope.

---

### Key implementation files

**Frontend (new):**
- `web/src/hooks/useTheme.ts` (or `web/src/theme/ThemeContext.tsx`) — read/persist theme; apply `data-theme` to `<html>`
- `web/src/components/ThemePicker.tsx` — the sidebar `<select>` control

**Frontend (modified):**
- `web/src/App.css` — `[data-theme="forest"]` and `[data-theme="midnight"]` palette blocks; new semantic error/surface tokens; convert the hardcoded backgrounds listed above
- `web/index.html` — inline bootstrap script that applies the saved theme before React mounts
- `web/src/components/Sidebar.tsx` — render `<ThemePicker />` in the footer, above Sign out
- `web/src/App.tsx` — wire `ThemeProvider` / `useTheme` if a context is used

---

### Scenarios

```
Scenario: Default theme is Teal for a first-time user
  Given I have never chosen a theme
  When  I open the app
  Then  the Teal palette is applied
  And   the theme picker shows "Teal" selected

Scenario: Selecting Forest reskins the app immediately
  Given I am on any screen
  When  I choose "Forest" in the theme picker
  Then  the app's colours change to the Forest palette without a reload

Scenario: Selecting Midnight switches to dark mode
  Given the app is in a light theme
  When  I choose "Midnight"
  Then  the background becomes dark and text becomes light
  And   no light-coloured panels or error backgrounds remain bright

Scenario: Theme choice persists across reloads
  Given I have selected "Midnight"
  When  I reload the app
  Then  Midnight is applied before the first paint (no flash of Teal)
  And   the picker still shows "Midnight" selected

Scenario: Corrupt or unknown stored value falls back to Teal
  Given localStorage holds an unrecognised theme value
  When  I open the app
  Then  the Teal palette is applied

Scenario: Theme is independent of the signed-in user
  Given I sign out and sign back in on the same browser
  Then  my last chosen theme is still applied
```

---

### Acceptance criteria

- [ ] Three themes are available — Teal (default), Forest, Midnight — each defined purely as CSS custom-property overrides; no component references a literal colour for themed surfaces
- [ ] A theme picker is rendered in the sidebar footer, above Sign out, with an accessible label
- [ ] Selecting a theme reskins the app immediately (no reload) and updates `document.documentElement[data-theme]`
- [ ] The choice is persisted to `localStorage` under a single key and restored on load
- [ ] The saved theme is applied before React mounts so there is no flash of the default theme on reload
- [ ] An unrecognised/missing stored value falls back to Teal
- [ ] Midnight dark-mode audit complete: `.notification-banner-enable`, `.todo-delete-btn`, `.transcription-error`, and `.transcription-stop-button:hover` no longer show hardcoded light backgrounds; converted to themed tokens
- [ ] Text contrast meets 4.5:1 in all three themes (per the design-system checklist)
- [ ] Theme preference is client-only — no event, projection, or API change
- [ ] Component tests cover: default is Teal, select Forest applies `data-theme="forest"`, select Midnight applies `data-theme="midnight"`, persistence across remount, fallback on bad stored value

---

## CHANGE-3 — Home screen shows today's notes by default

**Status:** ✅ Done — PR #101, deployed 2026-06-02. See [docs/learnings/phase-minor-3-home-todays-notes.md](../learnings/phase-minor-3-home-todays-notes.md).

**Value:** The home screen note list grows without bound — every note ever created is shown in API order, so the most recent work is buried and the screen gets noisier over time. This change focuses the home list on what's current: by default it shows the notes that matter **today** — those **dated today** plus any **edited today** (even if dated earlier) — and **hides future-dated notes**. A **"Show older notes"** toggle reveals past notes. Whatever is shown is ordered **reverse-chronologically** (newest first), so the freshest work is always at the top.

**Backend changes:** Minimal. The `NoteCardView` projection already carries `LastModifiedAt` and `NoteCardListEventHandler` bumps it on every content edit, rename, tag, date-set, and folder change — but `NoteHandlers.MapCardToResponse` does not currently serialise it. Add `lastModifiedAt = c.LastModifiedAt` to the cards response and `lastModifiedAt: string` to the frontend `NoteCard` type. No new event, no projection rebuild (the field is already populated on stored items). All filtering, the toggle, and sorting remain client-side in `ListView.tsx`.

---

### Behaviour

**Scope:** the home view only (`ListView` rendered with no `currentFolderId` — the `home-layout` branch). Folder views and the folder preview panel are unchanged: they continue to show all notes in the folder. Only the home notes list gains the date filter, toggle, and sort.

**Two derived values per card:**
- **Effective date** — `date` when present; otherwise the calendar date of `createdAt`. Drives the today/older/future split and the sort.
- **Edited today** — `true` when `lastModifiedAt` falls on the local calendar day. Lets a note touched today appear in the default view even if its effective date is earlier.

**Default (toggle off):** show a card when its effective date is **today**, OR it was **edited today** — *and* its effective date is **not in the future**. In short: today's notes, plus anything worked on today, with upcoming-dated notes hidden.

**Toggle on ("Show older notes"):** additionally show **past** notes (effective date `< today`). Combined with the default rule this means the toggle reveals the full set of non-future notes.

**Future-dated notes are hidden in both states.** Per your direction, upcoming-dated notes are kept off the home screen; opening the note (e.g. from a folder or a meeting link) still works. The one edge worth naming: a future-dated note that was *edited today* is still hidden — "hide future" wins over "edited today" so the rule stays predictable. Say the word if you'd rather edited-today always wins, or if future notes should appear under the toggle.

**Sort:** within the visible set, reverse-chronological by effective date (newest first). Ties broken by `lastModifiedAt` descending, so among same-dated notes the most recently touched is highest. Applied after the tag filter.

**Composition with existing tag filter:** the date filter and the tag filter compose — both narrow the list. "Show older notes" widens the date range; selected tags then narrow whatever dates are visible.

**Empty states:**
- The "Show older notes" toggle is **always rendered** in the home notes section, even when nothing matches today — otherwise a user whose notes are all in the past would be stranded with an empty screen and no way to reveal them.
- When the visible list is empty, show a gentle message ("No notes today" with the toggle still available; "No notes" if older are shown too).

---

### Key implementation files

**Backend (modified):**
- `src/Api/Handlers/NoteHandlers.cs` — add `lastModifiedAt = c.LastModifiedAt` to the object returned by `MapCardToResponse`
- `tests/Api.Integration/` — assert `/notes/cards` includes `lastModifiedAt`

**Frontend (modified):**
- `web/src/api.ts` — add `lastModifiedAt: string` to the `NoteCard` interface
- `web/src/components/ListView.tsx` — add `showOlder` state (default `false`); extend the home-branch list pipeline to (1) compute effective date + edited-today per card, (2) apply the default/older predicate (always excluding future), (3) sort reverse-chronologically; render the toggle in the home notes section; render empty-state copy. Keep the folder-branch list path untouched.
- `web/src/App.tsx` — the optimistic new-note card created in `handleNewNote` must include `lastModifiedAt` (set to now) so the type is satisfied and a freshly created note appears in the today view.
- `web/src/dates.ts` (new, or a small local helper) — `effectiveDate(card)`, `isEditedToday(card)`, `localTodayISO()` so the comparisons are pure and unit-testable.

---

### Note on "today"

Compute today as the **local** calendar date (`YYYY-MM-DD`), not `new Date().toISOString().slice(0,10)` — the latter is UTC and would flip a day early/late for users behind/ahead of UTC near midnight. (The existing note-date default in `App.tsx` uses the UTC slice; that inconsistency is pre-existing and out of scope here, but the home filter should use local date so "today" matches the user's wall clock.) Derive the edited-today flag by converting `lastModifiedAt` to the local date and comparing the `YYYY-MM-DD` strings — avoid time-of-day arithmetic and timezone drift; see the time-bomb/timezone learnings.

---

### Scenarios

```
Scenario: Home shows today's notes by default
  Given I have notes dated today and notes dated last week
  When  I open the home screen
  Then  only the notes dated today are listed
  And   the older notes are not shown

Scenario: A note edited today appears even if dated earlier
  Given a note dated last week that I edited today
  When  I open the home screen with the toggle off
  Then  that note is listed

Scenario: A note dated and edited before today is hidden by default
  Given a note dated last week that I have not edited today
  When  I open the home screen with the toggle off
  Then  that note is not listed

Scenario: Future-dated notes are hidden by default
  Given a note dated next week
  When  I open the home screen
  Then  that note is not listed
  And   turning on "Show older notes" does not reveal it

Scenario: Notes are listed newest-first
  Given notes dated today, yesterday, and two days ago
  And   "Show older notes" is on
  Then  they appear in the order today, yesterday, two days ago

Scenario: Toggling "Show older notes" reveals past notes
  Given older notes exist and the toggle is off
  When  I turn on "Show older notes"
  Then  the past-dated notes appear below today's notes in reverse-chronological order

Scenario: Toggling off hides past notes again
  Given "Show older notes" is on and past notes are visible
  When  I turn it off
  Then  only today's notes and notes edited today remain

Scenario: A note with no explicit date sorts by its creation date
  Given a note has no date set but was created yesterday
  And   "Show older notes" is on
  Then  it is grouped and ordered as a yesterday note

Scenario: Toggle is available when there are no notes today
  Given all my notes are dated in the past and none edited today
  When  I open the home screen
  Then  the note list shows "No notes today"
  And   the "Show older notes" toggle is still visible
  And   turning it on reveals the past notes

Scenario: Date filter composes with the tag filter
  Given "Show older notes" is on and I select the tag "work"
  Then  only notes tagged "work" are listed, still newest-first

Scenario: Folder view is unaffected
  Given I open a folder
  Then  all notes in that folder are shown regardless of date
  And   there is no "Show older notes" toggle in folder view
```

---

### Acceptance criteria

- [ ] `/notes/cards` includes `lastModifiedAt` and the frontend `NoteCard` type declares it
- [ ] On the home screen with the toggle off, a note is shown when its effective date is today OR it was edited today, and never when its effective date is in the future
- [ ] Future-dated notes are hidden in both toggle states
- [ ] A "Show older notes" toggle is present in the home notes section and is always visible, including when nothing matches today
- [ ] Turning the toggle on reveals past-dated (effective date `< today`) notes; turning it off hides them again
- [ ] The visible notes are ordered reverse-chronologically by effective date (newest first), `lastModifiedAt` desc as tiebreaker
- [ ] Effective date falls back to the `createdAt` calendar date when `date` is null
- [ ] "Today" and "edited today" are computed from the local calendar date, compared as `YYYY-MM-DD` strings
- [ ] The date filter composes with the existing tag filter and AND/OR mode
- [ ] Folder views and the folder preview panel are unchanged — no date filtering, no toggle
- [ ] Empty-state copy shown when the visible list is empty ("No notes today" / "No notes")
- [ ] `effectiveDate` / `isEditedToday` / `localTodayISO` helpers are pure and unit-tested
- [ ] Component tests cover: today-only default, edited-today inclusion, future hidden in both states, toggle reveals/hides older, reverse-chron order, null-date fallback, toggle visible with empty today list, composition with tag filter, folder view unaffected

---

## CHANGE-4 — To-do rows wrap cleanly with long text and a note title

**Status:** ✅ Done — PR #104, deployed 2026-06-02. See [docs/learnings/phase-minor-4-todo-row-wrap.md](../learnings/phase-minor-4-todo-row-wrap.md). Prototype on branch `prototype/todo-row-wrap` (`todo-row-wrap-prototype.html`) was approved 2026-06-02 and implemented verbatim as the confirmed layout below.

**Value:** A to-do row in the **To Do** section is laid out as a single flex row — `checkbox · description · note-title · Delete` — with `justify-content: space-between` (`.todo-item`, `App.css` ~L821). The note title (`.todo-note-title`, ~L853) carries `white-space: nowrap`, so when a note-derived to-do has a long title (e.g. *"Head of Technical Delivery – Finova"*) it reserves a wide fixed strip of horizontal space. That squeezes the description column to near-zero width, forcing the description to wrap **one word per line** and growing the row to an absurd height, while the **Delete** button is pushed off the right edge and clipped. Short to-dos look fine; long ones become unusable. The row should stay compact: the description wraps normally, the note title sits beneath it as a quiet caption, and the Delete/Reopen control stays pinned and fully visible at all widths.

**Backend changes:** None. Pure layout/styling fix in the existing To-Do UI — no event, projection, API, or `TodoItem` shape change. `description`, `noteTitle`, and the complete/reopen/delete behaviour are all unchanged.

---

### Prototype requirement

Run the **prototype** skill first (this is a UX/layout-uncertain change, not obvious CRUD). Build a throwaway frontend-only prototype on a `prototype/todo-row-wrap` branch/worktree that renders the To Do list with a deliberately hostile mix of items:

- a short standalone to-do (no note title)
- a short note-derived to-do with a long note title
- a very long description with a long note title (the failing case in the bug report)
- a long description with **no** note title

Use it to confirm the chosen layout — description + note title stacked in a content column, Delete pinned right — holds up across the narrow home-column width **and** the wider full-width breakpoint, in both the open list and the expanded **Done** list (Reopen + Delete buttons). On approval, the exit procedure rewrites this change's GWT scenarios with the confirmed layout before real implementation begins. No prototype code is merged.

---

### Approved layout (confirmed by prototype, 2026-06-02)

The prototype (`prototype/todo-row-wrap` → `todo-row-wrap-prototype.html`) was reviewed and **approved**. The confirmed layout, to implement verbatim:

- Wrap `.todo-description` + `.todo-note-title` in a new `.todo-item-content` div, in **both** the open-items `<li>` and the Done `<li>`.
- `.todo-item-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.125rem; }` — `min-width: 0` is load-bearing (lets the text wrap instead of forcing overflow).
- Remove `flex: 1` from `.todo-description` and `white-space: nowrap` from `.todo-note-title`; add `overflow-wrap: anywhere` to both so a single long token can't overflow.
- `.todo-item` uses **`align-items: flex-start`** (confirmed preference) so the checkbox sits against the first line of a tall, wrapped row rather than floating in the vertical centre.
- The full text **wraps** — no truncation/ellipsis; nothing the user wrote is hidden.
- Checkbox and Delete/Reopen buttons keep `flex-shrink: 0` and stay pinned and fully visible at all widths.

The scenarios and acceptance criteria below already reflect this layout. Remove the `prototype/todo-row-wrap` branch after the slice ships.

---

### Approach

Keep the markup change minimal and apply it to **both** the open-items list and the Done list so the two stay consistent:

1. Wrap the description and note title in a content column — e.g. `<div className="todo-item-content">` — between the checkbox and the action button(s). This is the only structural change.
2. Give that column `flex: 1; min-width: 0;` and stack its children (`display: flex; flex-direction: column`). `min-width: 0` is the load-bearing part: it lets the description wrap inside the available space instead of the flex item refusing to shrink below its content width.
3. Drop `white-space: nowrap` from `.todo-note-title` and let both the description and the title wrap with `overflow-wrap: anywhere`, so a single very long token can never force horizontal overflow.
4. The checkbox (`flex-shrink: 0`) and the Delete/Reopen buttons (`flex-shrink: 0`) already stay fixed; with the description no longer fighting the title for horizontal room, the buttons remain on-row and fully visible.

Vertical alignment: with a multi-line content column, consider `align-items: flex-start` (or keep `center`) on `.todo-item` — confirm in the prototype which reads better; the checkbox should sit against the first line, not float in the vertical centre of a tall row.

**Why CSS + a wrapper div, not JS truncation:** truncating the description or note title with an ellipsis would hide content the user wrote; the bug is that long content is laid out badly, not that it is too long to show. Letting it wrap inside a constrained column preserves the full text while keeping the row compact and the actions reachable.

---

### Key implementation files

**Frontend (modified):**
- `web/src/components/TodoSection.tsx` — wrap `.todo-description` + `.todo-note-title` in a `.todo-item-content` div in **both** the open-items `<li>` (~L133) and the Done `<li>` (~L161)
- `web/src/App.css` — add `.todo-item-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.125rem; }`; remove `flex: 1` from `.todo-description` and `white-space: nowrap` from `.todo-note-title`; add `overflow-wrap: anywhere` to both (~L848–858); review `align-items` on `.todo-item` (~L821)

No `.tsx` logic, handler, or API change. Existing `TodoSection` component tests query by text and role, so the wrapper div does not affect them — but re-run them to confirm.

---

### Scenarios

```
Scenario: A long to-do with a note title wraps without clipping the Delete button
  Given a note-derived to-do with a long description and a long note title
  When  I view the To Do section
  Then  the description wraps across multiple lines within its column
  And   the note title appears beneath the description
  And   the Delete button is fully visible and not pushed off the row

Scenario: A long description with no note title wraps normally
  Given a standalone to-do with a long description and no note title
  When  I view the To Do section
  Then  the description wraps to readable line lengths, not one word per line
  And   the Delete button remains visible

Scenario: A short to-do still renders on a single compact row
  Given a short to-do
  When  I view the To Do section
  Then  the checkbox, description, and Delete button sit on one line as before

Scenario: Done items with long text wrap consistently
  Given a completed note-derived to-do with a long description and note title
  When  I expand the Done list
  Then  the description and note title wrap in the same stacked layout
  And   both the Reopen and Delete buttons remain visible

Scenario: The to-do data is unchanged by the layout fix
  Given any to-do
  When  I complete, reopen, or delete it
  Then  the existing behaviour and API calls are unchanged (the fix is visual only)
```

---

### Acceptance criteria

- [x] A to-do with a long description and a long note title renders with the description wrapped across lines and the note title beneath it — never one word per line
- [x] The Delete (open list) and Reopen + Delete (Done list) buttons stay pinned and fully visible at the narrow home-column width and the wider breakpoint
- [x] Short to-dos still render on a single compact row, visually unchanged from today
- [x] The same stacked layout is applied to both the open-items list and the expanded Done list
- [x] `.todo-note-title` no longer uses `white-space: nowrap`; long titles wrap instead of reserving fixed horizontal space
- [x] No change to `TodoItem`, events, projections, the API, or complete/reopen/delete behaviour — the fix is visual only
- [x] Existing `TodoSection` component tests remain green; a test asserts a long-description note-derived item still exposes its description and the Delete control
- [x] Prototype built and approved before implementation; confirmed layout reflected in the scenarios above

---

## CHANGE-5 — Sign-in screen visual polish

**Status:** Planned

**Value:** The sign-in screen is the first thing a user sees, and it is currently unstyled. `web/src/components/SignInPage.tsx` renders a bare `<h1>AI Note Taker</h1>` and a default browser `<button>Sign in with Google</button>` inside a `.sign-in-page` div for which **no CSS exists** — so it falls back to Times New Roman-ish defaults, a top-left heading, and a grey system button on a plain background. It reads as broken rather than intentional. This change gives the sign-in screen a polished, on-brand first impression consistent with the rest of the app, without changing the auth flow.

**Backend changes:** None. Pure presentation. The `useAuth().signIn` call, the OAuth flow, and the no-auth bypass path (`VITE_GOOGLE_CLIENT_ID` absent) are all untouched.

---

### Approach

Style-only, building on the app's existing design tokens (`--color-primary`, `--color-bg`, `--color-surface`, `--color-cta`, etc.) so the sign-in screen inherits whatever theme is active (this composes naturally with CHANGE-2's theming — it must not hardcode colours).

Run the **ui-ux-pro-max** (Stylist) skill against `SignInPage.tsx` to produce the polish, working from `web/design-system/MASTER.md` if present. Target shape:

- A centred card on a full-height branded background (use `--color-bg`; a subtle gradient or the primary tint is acceptable).
- App wordmark/title in the app's display font and `--color-text`, optionally with a short tagline.
- A clearly styled primary "Sign in with Google" button (the established Google button conventions — Google "G" mark, adequate padding, hover/focus states), using `--color-cta`/`--color-primary` per the design system, not the raw browser default.
- Accessible focus ring, 4.5:1 contrast, sensible sizing on mobile and desktop, and a visible loading/disabled state while `signIn` is in flight if the auth context exposes one.

Add the styles under a new `.sign-in-page` (and child) block in `App.css`. Keep markup changes minimal — a card wrapper and the Google mark are fine; do not restructure the auth wiring.

**Why Stylist, not a from-scratch rebuild:** the component's behaviour is correct and trivial; only its appearance is missing. The design-system skill gives an on-brand result that stays consistent with the rest of the app and the themes.

---

### Key implementation files

**Frontend (modified):**
- `web/src/components/SignInPage.tsx` — minimal markup wrapper for the card + Google mark; no auth-flow change
- `web/src/App.css` — new `.sign-in-page` styles using design tokens (currently none exist)

No `.ts`, handler, event, projection, or API change.

---

### Scenarios

```
Scenario: Sign-in screen is visually polished and on-brand
  Given I am signed out
  When  the sign-in screen loads
  Then  the title and "Sign in with Google" button are presented in a centred, branded card
  And   colours are drawn from the active theme's design tokens, not browser defaults

Scenario: Sign-in still works after the restyle
  Given I am on the styled sign-in screen
  When  I click "Sign in with Google"
  Then  the existing OAuth sign-in flow runs exactly as before

Scenario: Sign-in screen respects the selected theme
  Given a theme is active (e.g. Midnight, once CHANGE-2 ships)
  When  the sign-in screen loads
  Then  it uses that theme's background, surface, and text colours

Scenario: No-auth bypass is unaffected
  Given VITE_GOOGLE_CLIENT_ID is absent
  When  the app loads
  Then  the home screen is shown without the sign-in screen, as today
```

---

### Acceptance criteria

- [ ] The sign-in screen renders a centred, branded card (title + Google sign-in button) instead of bare unstyled defaults
- [ ] All colours come from existing CSS custom properties — no hardcoded literals — so it composes with CHANGE-2 theming
- [ ] The "Sign in with Google" button has clear hover/focus states and meets 4.5:1 contrast
- [ ] The auth flow (`useAuth().signIn`), OAuth path, and no-auth bypass are unchanged — visual only
- [ ] Layout holds on mobile and desktop widths
- [ ] Existing `Auth` / `SignInPage` tests remain green
- [ ] Stylist (ui-ux-pro-max) run recorded; result consistent with `web/design-system/MASTER.md`

---

## CHANGE-6 — Collapsible "Filters" control for home tags

**Status:** Planned

**Value:** On the home screen the tag filter (`TagFilter`) currently sits at the top of the home-left column, permanently expanded, pushing the Notes list down and adding visual noise before the user has expressed any intent to filter. Tag filtering is an occasional action, not a constant one. This change moves the tag filter **inside the Notes section, under a collapsible "Filters" control that defaults to collapsed** — so the home screen leads with the notes, and filtering is one click away when wanted.

**Backend changes:** None. Pure frontend layout/interaction change. Tag data, the filter logic, AND the today/older date filter (CHANGE-3) are all unchanged — only the *placement and visibility* of the existing `TagFilter` control changes.

---

### Behaviour

- **Scope:** the **home view only** (`ListView` rendered with no `currentFolderId`). Folder views are out of scope for this item — leave their `TagFilter` placement as-is unless a follow-up says otherwise.
- The tag filter moves from the top of `home-left` to **inside the Notes section** (`.note-cards-section`), beneath the existing Notes header/`Show older notes` row.
- A **"Filters" toggle** (button) controls visibility of the `TagFilter`. **Defaults to collapsed** — the `TagFilter` is not shown until the user expands it.
- When collapsed, only the "Filters" control (with a chevron/indicator) is visible; expanding reveals the tag pills, AND/OR mode toggle, and Clear control exactly as today.
- **Active-filter affordance:** when tags are selected but the panel is collapsed, the control must indicate that a filter is active (e.g. a count badge "Filters (2)" or a dot) so a user isn't confused by a filtered list with no visible filter. Expanding still shows the full control; Clear still works.
- Collapsed/expanded is **component UI state** (`useState`), not persisted — a page reload returns to the default collapsed state. (Persisting the open/closed state is a possible future tweak, not in scope.)
- The filter continues to **compose with the CHANGE-3 date filter**: collapsing the Filters panel does not change which notes are shown; it only hides the controls. Selected tags continue to narrow the (date-filtered) list whether the panel is open or closed.

---

### Approach

`ListView` already owns `selectedTags` / `filterMode` and renders `<TagFilter />` in the `home-left` column above the Notes section. Move that render **into** the `.note-cards-section`, wrapped in a collapsible region:

1. Add `const [filtersOpen, setFiltersOpen] = useState(false)` (default collapsed) to `ListView`.
2. Render a "Filters" toggle button inside the Notes section header area, showing an active-count when `selectedTags.length > 0` and collapsed.
3. Conditionally render the existing `<TagFilter />` below the toggle when `filtersOpen` is true. No change to `TagFilter` itself or to the filter logic.
4. Remove the old top-of-`home-left` `TagFilter` render so it isn't duplicated.
5. Add accessible wiring: the toggle uses `aria-expanded` and `aria-controls`; the panel has a matching `id`.

Keep the folder-view branch untouched.

---

### Key implementation files

**Frontend (modified):**
- `web/src/components/ListView.tsx` — add `filtersOpen` state; move `<TagFilter />` into the Notes section behind the collapsible "Filters" toggle (home branch only); active-count badge when collapsed with tags selected
- `web/src/App.css` — styles for the `.filters-toggle` control and the collapsible panel; chevron/indicator and active-state affordance

No API, event, projection, or `TagFilter` component change.

---

### Scenarios

```
Scenario: Filters are collapsed by default on the home screen
  Given I open the home screen
  Then  the tag filter controls are not visible
  And   a "Filters" control is shown in the Notes section

Scenario: Expanding Filters reveals the tag controls
  Given the Filters control is collapsed
  When  I click "Filters"
  Then  the tag pills, AND/OR mode toggle, and Clear control are shown

Scenario: Collapsing Filters hides the controls again
  Given the Filters panel is expanded
  When  I click "Filters"
  Then  the tag controls are hidden

Scenario: A collapsed Filters control still indicates active filters
  Given I have selected the tag "work"
  When  I collapse the Filters panel
  Then  the Filters control indicates that a filter is active (e.g. a count)
  And   the notes list remains filtered to "work"

Scenario: Filters default to collapsed after reload
  Given I expanded Filters and selected a tag
  When  I reload the home screen
  Then  the Filters control is collapsed again
  And   (filter open/closed state is not persisted)

Scenario: Folder view is unaffected
  Given I open a folder
  Then  the folder view's tag filter behaves exactly as before this change
```

---

### Acceptance criteria

- [ ] On the home screen the tag filter is rendered inside the Notes section under a "Filters" control, not at the top of the column
- [ ] The Filters control defaults to collapsed; the tag controls are hidden until expanded
- [ ] Expanding/collapsing toggles the tag pills, mode toggle, and Clear control; the toggle exposes `aria-expanded`/`aria-controls`
- [ ] When collapsed with tags selected, the control shows an active-filter affordance (e.g. a count)
- [ ] Filtering still composes with the CHANGE-3 today/older date filter; collapsing does not change which notes are listed
- [ ] Open/closed state is component-local (not persisted); reload returns to collapsed
- [ ] Folder view tag filtering is unchanged
- [ ] No API/event/projection/`TagFilter` change — frontend layout/interaction only
- [ ] Component tests cover: default collapsed, expand reveals controls, collapse hides them, active-count when collapsed with a selected tag, filtering composes with the date filter

---

## CHANGE-7 — More colour schemes; drop duplicate Forest theme

**Status:** Prototype approved — ready to implement. Gallery prototype on branch `prototype/minor-7-colour-schemes` (`colour-schemes-prototype.html`), approved 2026-06-02. Confirmed set: **12 themes** (8 light, 4 dark) — Forest dropped as a Teal duplicate; all visually-distinct candidates kept. Implement the confirmed palette table below as a normal slice. Do **not** start from prototype code.

**Value:** CHANGE-2 shipped three themes — Teal (default), Forest, Midnight. In practice **Teal and Forest are visually almost identical**: both are light themes with a green/emerald primary on a near-white green-tinted background (Teal `#0D9488`/`#F0FDFA`, Forest `#059669`/`#ECFDF5`), so the picker offers a choice with no perceptible difference. This change **removes Forest** and **adds nine genuinely distinct palettes**, so the picker offers a real spread of looks across the hue wheel and several dark options. Teal stays as the `:root` default; Midnight stays as a dark theme.

**Backend changes:** None. Themes remain pure CSS custom-property overrides selected by `data-theme` and persisted in `localStorage`, exactly as CHANGE-2 established. No event, projection, or API change.

---

### What changes

1. **Remove Forest.** Delete the `[data-theme="forest"]` palette block, the Forest `<option>` in `ThemePicker`, and `forest` from the theme type union / valid-values list. Anything previously persisted as `forest` falls through the existing unknown-value guard to Teal (the same fallback CHANGE-2 already ships) — no migration needed.
2. **Add the nine confirmed distinct palettes** (table below). Each is a new `[data-theme="…"]` block re-declaring the same custom properties; no component touches a literal colour.
3. **Picker scales as-is.** The sidebar `<select>` just gains/loses `<option>`s; no structural change.

---

### Confirmed palettes *(prototype-approved 2026-06-02)*

Twelve themes survive the gallery: Teal (default) and Midnight are unchanged; Forest is removed as a Teal duplicate; nine new distinct palettes are added (seven light, three dark). `data-theme` key is the lowercase name (`teal` is `:root`, no attribute needed).

**Light themes**

| Theme | key | Primary | Primary-dark | CTA | Background | Surface | Text | Text-muted | Border |
|-------|-----|---------|--------------|-----|------------|---------|------|-----------|--------|
| **Teal** *(default)* | — | `#0D9488` | `#0F766E` | `#F97316` | `#F0FDFA` | `#FFFFFF` | `#134E4A` | `#64748B` | `#CCEBE8` |
| **Indigo** | `indigo` | `#4F46E5` | `#4338CA` | `#F97316` | `#EEF2FF` | `#FFFFFF` | `#1E1B4B` | `#64748B` | `#C7D2FE` |
| **Rose** | `rose` | `#E11D48` | `#BE123C` | `#0EA5E9` | `#FFF1F2` | `#FFFFFF` | `#4C0519` | `#6B7280` | `#FECDD3` |
| **Amber** | `amber` | `#D97706` | `#B45309` | `#2563EB` | `#FFFBEB` | `#FFFFFF` | `#451A03` | `#78716C` | `#FDE68A` |
| **Violet** | `violet` | `#7C3AED` | `#6D28D9` | `#F59E0B` | `#F5F3FF` | `#FFFFFF` | `#2E1065` | `#6B7280` | `#DDD6FE` |
| **Sky** | `sky` | `#0284C7` | `#0369A1` | `#F97316` | `#F0F9FF` | `#FFFFFF` | `#0C2A3E` | `#64748B` | `#BAE6FD` |
| **Sepia** | `sepia` | `#B45309` | `#92400E` | `#0D9488` | `#FAF6EF` | `#FFFDF8` | `#44372A` | `#8C7A63` | `#E8DCC8` |
| **Contrast** | `contrast` | `#1D4ED8` | `#1E3A8A` | `#B91C1C` | `#FFFFFF` | `#FFFFFF` | `#000000` | `#374151` | `#1F2937` |

**Dark themes** (each reuses semantic `--color-error` / `--color-error-bg` so no hardcoded light background leaks through — see CHANGE-2 dark-mode audit)

| Theme | key | Primary | Primary-dark | CTA | Background | Surface | Text | Text-muted | Border | error / error-bg |
|-------|-----|---------|--------------|-----|------------|---------|------|-----------|--------|------------------|
| **Midnight** | `midnight` | `#2DD4BF` | `#14B8A6` | `#FB923C` | `#0F172A` | `#1E293B` | `#E2E8F0` | `#94A3B8` | `#334155` | `#F87171` / `#3F1D1D` |
| **Slate** | `slate` | `#818CF8` | `#6366F1` | `#FB923C` | `#0B1120` | `#1E293B` | `#E2E8F0` | `#94A3B8` | `#334155` | `#F87171` / `#3F1D1D` |
| **Carbon** | `carbon` | `#F59E0B` | `#D97706` | `#38BDF8` | `#1C1917` | `#292524` | `#F5F5F4` | `#A8A29E` | `#44403C` | `#F87171` / `#3A201C` |
| **Plum** | `plum` | `#FB7185` | `#F43F5E` | `#38BDF8` | `#1A0E14` | `#2B1721` | `#FCE7F3` | `#C99BAC` | `#4A2C39` | `#FDA4AF` / `#3F1D29` |

As in CHANGE-2: `--color-primary-bg` follows the primary at ~6% opacity (light) / ~10% (dark); `--color-cta-dark` is the CTA one step darker. CTA colours are chosen to contrast with each theme's primary (e.g. Rose pairs a red primary with a sky-blue CTA). The closest remaining pair is Indigo vs Violet — both kept as distinct (blue-leaning vs true purple). Each light theme must clear 4.5:1 text contrast; verify before merge.

---

### Key implementation files

**Frontend (modified):**
- `web/src/App.css` — remove the `[data-theme="forest"]` block; add a `[data-theme="…"]` block per new theme, re-declaring the custom properties
- `web/src/components/ThemePicker.tsx` — drop the Forest `<option>`; add one `<option>` per new theme
- `web/src/hooks/useTheme.ts` (or the theme context) — update the valid-values list / type union: remove `forest`, add the new theme keys; unknown values still fall back to Teal
- `web/index.html` — the inline pre-mount bootstrap already applies whatever `data-theme` is stored; confirm it still validates against the updated allow-list if it does any validation

No `.ts` handler, event, projection, or API change.

---

### Scenarios

```
Scenario: Forest is no longer offered
  Given I open the theme picker
  Then  there is no "Forest" option
  And   Teal, Midnight, and the new themes are listed

Scenario: A previously-saved Forest preference falls back to Teal
  Given localStorage holds the theme value "forest"
  When  I open the app
  Then  the Teal palette is applied (unknown value falls back to default)

Scenario: Each new theme reskins the app immediately and is visually distinct
  Given I am on any screen
  When  I choose a new theme (e.g. Indigo) in the picker
  Then  the app's colours change to that palette without a reload
  And   the result is clearly distinguishable from Teal

Scenario: A new dark theme keeps dark-mode surfaces dark
  Given I choose Slate
  Then  the background and surfaces are dark and text is light
  And   no light-coloured panels or error backgrounds remain bright

Scenario: A new theme choice persists across reloads
  Given I have selected a new theme
  When  I reload the app
  Then  that theme is applied before the first paint (no flash of Teal)
  And   the picker still shows it selected
```

---

### Acceptance criteria

- [ ] The Forest theme is removed: no `[data-theme="forest"]` block, no Forest `<option>`, `forest` removed from the valid-values/type union
- [ ] A previously-stored `forest` (or any unknown) value falls back to Teal — no console error, no broken palette
- [ ] The confirmed set of new themes is added, each defined purely as CSS custom-property overrides; no component references a literal colour for themed surfaces
- [ ] Each new theme is visually distinct from Teal and from the other themes (not a near-duplicate)
- [ ] Selecting any new theme reskins the app immediately (no reload), updates `document.documentElement[data-theme]`, and persists to `localStorage`
- [ ] The saved theme is applied before React mounts so there is no flash of the default theme on reload
- [ ] Each light theme meets 4.5:1 text contrast; each dark theme reuses CHANGE-2's semantic error/surface tokens so no hardcoded light background leaks through
- [ ] Theme preference remains client-only — no event, projection, or API change
- [ ] `ThemePicker` component tests updated: Forest gone, each new theme applies its `data-theme`, persistence across remount, fallback on the now-invalid `forest` value
