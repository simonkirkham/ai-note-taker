# Prototype REFERENCE — CHANGE-27 Tags + Actions redesign

Branch: `prototype/tags-actions-sidebar` (reference only, never merged).
Chosen design: **Command Bar** (tab 4). Tabs 1–3, 5, 6 were explored alternatives; tab 3 (Strip + Dock) was an earlier favourite kept for comparison.

## Confirmed UX (Command Bar)

- **Full-width editor.** The note-detail `1fr 320px` grid is replaced by a single full-width column; the right sidebar is deleted.
- **One Command Bar** under the title, above the tabs. `display:flex; justify-content:space-between`, single line, ~44px.
- **Left region — Tags:**
  - A muted tag glyph, then inline removable chips (pill shape, `× ` remove).
  - A dashed `＋ Tag` ghost button; clicking it swaps in the tag combobox input (autocomplete), reusing the existing `TagsSection` behaviour. Enter adds; tags are lowercase-normalised (CHANGE-17).
  - Overflow: chips scroll horizontally (hidden scrollbar); the bar never wraps to a second line.
- **Right region — Actions:**
  - A pill `✓ Actions · {done}/{total}` — count always visible without opening.
  - Click toggles a **floating popover** (`position:absolute`, anchored top-right under the pill, `width ≈ 304px`, `max-height:60vh`, internal scroll, heavy shadow `0 10px 28px rgba(0,0,0,.14)`, `z-index:40`).
  - Popover = sticky header (`Actions` + count) + the checklist (checkbox toggle, `× ` delete) + an add-input. Empty state: "No action items yet" + the add-input.
- **All-done state:** when `total > 0 && open === 0`, the pill (icon + count) and the popover-header count render in `--color-primary` (teal). Reverts to neutral when an item is reopened.
- **Popover dismissal:** closes on click **outside** the right region and on **Esc**; clicks **inside** (toggle/add/delete) keep it open; stays open after adding so several items can be entered.
- **Icons:** inline SVG (tag, check, chevron, plus) using `currentColor` — no emoji.
- **Mobile (narrow):** the popover should render as a bottom sheet instead of a floating anchor (specced; not built in the prototype).

## API / data shapes — NO new ones

Pure relocation. Reuse verbatim:
- **Tags:** existing `TagsSection` combobox + `useTagSuggestions(input, allTags, tags)`; `onAdd(tag)` / `onRemove(tag)` on the note. Lowercase normalisation already in place.
- **Actions:** `useActions(noteId)` for `{ actionId, description, completed, ... }[]`; `useActionMutations` (`useAddAction`/`useCompleteAction`/`useReopenAction`/`useDeleteAction`) — all optimistic.
- The pill count derives from the same `useActions` query, so it updates optimistically with toggles/adds/deletes.

## Component-structure decisions for the real slice

- Remove the `<aside className={tabStyles.sidebar}>` and the `grid-template-columns:1fr 320px` (in `NoteView.tsx` / `NoteTabs.module.css`) → single full-width column.
- New `CommandBar` component rendered in `NoteView` between the title and the tab row.
- Tags sub-region wraps the existing `TagsSection` combobox logic (chips + ghost `＋ Tag` → input).
- Actions sub-region = pill + popover wrapping the existing `ActionsSection` checklist; popover open-state is local `useState`; outside-click via a ref + `mousedown` listener; Esc via `keydown`.
- Keep optimistic-first behaviour (mandatory) and all existing `data-testid`s where practical.

## localStorage keys

None. Popover open-state is ephemeral.

## Not chosen (rationale, for the record)

- Sidebar-preserving designs (Quiet Rail, Ledger) rejected — still consumed the side column; the goal was full-width notes.
- Pinboard (overlay drawer) and Property Band (two-up header) and Strip + Dock all met full-width but the Command Bar was preferred for keeping both controls on one unobtrusive line with the actions list out of the page flow.
