# Phase 13 — UI Polish II

**Goal:** A second pass of targeted UI improvements and tweaks that make the editor and surrounding screens feel tighter and more intentional. As with Phase 11, these are frontend-focused slices that build on what already exists — no new aggregates, events, or projections.

**Learning surface:** ProseMirror/TipTap node styling and the gap between markdown semantics and visual rendering; CSS that targets editor-managed DOM; keeping component tests honest about purely visual behaviour.

---

## Slice order and dependencies

```
13-A  Single-spaced note lines by default ───────────────────── independent
13-B  Theme selection (Forest + Midnight) ────────────────────── independent
```

Further slices will be appended as they are identified.

---

## Slice 13-A — Single-spaced note lines by default

**Status:** Planned

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

## Slice 13-B — Theme selection

**Status:** Planned

**Value:** Users can choose a colour theme for the app. The whole UI already draws every colour from CSS custom properties on `:root` (`--color-primary`, `--color-bg`, `--color-text`, `--color-cta`, `--color-border`, etc.), so theming is a matter of overriding those variables and remembering the choice. This slice ships three themes — the current **Teal** (default), **Forest** (deeper emerald, light), and **Midnight** (full dark mode) — selectable from a small picker in the sidebar footer and persisted across sessions.

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

Most colours are variables and flip automatically, but a grep of `App.css` turns up a handful of **hardcoded light backgrounds** that would render as bright patches in Midnight and must be converted to variables (or given `[data-theme="midnight"]` overrides) as part of this slice:

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
