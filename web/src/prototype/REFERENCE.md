# 50-B prototype — REFERENCE

Approved 2026-08-09. Variant **D — overflow menu**. This file is the implementation brief;
the real slice rebuilds from scratch in `web/src/components/TodoSection.tsx` and does not
copy prototype code.

## Confirmed UX

| Decision | Confirmed shape |
| --- | --- |
| Control | One `⋯` overflow menu per **open** to-do row |
| Menu contents | `Move to Today` / `Move to Later` (label flips by side), `Send to top`, `Send to bottom` |
| Delete | **Stays on the row** as its own icon button — not in the menu |
| Row after change | `[grip] [checkbox] description [⋯] [🗑]` — send-to-top/bottom icons move into the menu |
| Promote placement | Item lands **last in Today**, directly above the line |
| Demote placement | Item lands **first in Later**, directly below the line |
| Optimism | Menu closes and the list re-renders on click, before the save resolves |

Rejected variants: A (fourth icon — cluster too dense), B (text button — costs row width,
long descriptions wrap), C (line-aware arrows — silently redefines CHANGE-34 and removes
one-click send-to-top from Later).

## Menu behaviour (all confirmed in the prototype)

1. `Escape` closes the menu and **returns focus to the `⋯` trigger**.
2. Click outside closes the menu (no refocus).
3. `ArrowDown` / `ArrowUp` on the trigger opens the menu.
4. `ArrowDown` / `ArrowUp` inside rove the items, wrapping at both ends.
5. `Enter` / `Space` activate the focused item, then close and refocus the trigger.
6. `Tab` closes the menu without refocusing, so focus moves on naturally.
7. Only one menu is open at a time — opening one closes any other.
8. Roving tabindex: the active item is `tabIndex={0}`, the rest `-1`.

ARIA: trigger carries `aria-haspopup="menu"` + `aria-expanded`; container is `role="menu"`;
items are `role="menuitem"`.

## Placement maths (mirrors 50-A's anchor model)

The line sits immediately **above** its anchor; `null` anchor = below everything.
`splitAt = anchorIndex >= 0 ? anchorIndex : openItems.length`.

- **Demote (Today → Later):** `arrayMove(ids, from, splitAt - 1)`, then **re-anchor to the moved
  item** so it becomes the first Later row.
- **Promote (Later → Today):** `arrayMove(ids, from, splitAt)`, anchor unchanged — the anchor
  shifts down one index and the item lands last in Today.
- **Promoting the anchor itself** must re-anchor to the next Later item first
  (`laterItems[1]?.id ?? null`), otherwise the line travels with the row and Today swallows
  everything below it. Same hazard `reanchorIfLineWouldFollow` already guards on the drag path.

## API shapes

**None new.** Reuses the existing `reorderTo` → `useReorderTodos` path plus 50-A's
`useSetTodayLine`. A demote issues **both** a reorder and a line-anchor write; a promote issues
a reorder only (unless the moved item was the anchor).

Ordering: kick off the reorder, then re-anchor in the **same tick before awaiting**, matching
the existing `sendTo` comment at `TodoSection.tsx:170-175`.

## Component structure

- Extract a `RowMenu` component (trigger + popup + keyboard) rather than inlining — the
  keyboard/dismissal logic is ~60 lines and does not belong in `TodoSection`'s body.
- `RowMenu` takes `label`, `open`, `onOpenChange`, and an `actions: {label, run, danger?}[]`
  array so it stays presentational.
- Open-menu state (`openMenuId`) lives in `TodoSection` so only one row's menu is open at once.
- The prototype's `p.menu` / `p.menuWrap` / `p.ellipsis` CSS transfers to
  `TodoSection.module.css` largely as-is; drop `.menuItemDanger` (delete is not in the menu).

## localStorage keys (prototype only — do NOT ship)

`proto50b.variant`, `proto50b.items`, `proto50b.anchor`, `proto50b.deleteInMenu`.

## Known gaps the real slice must close

1. Prototype delete is stubbed — real rows keep the existing `handleDelete`, including 50-A's
   awaited line step-down when the anchor is deleted (`TodoSection.tsx:297-302`).
2. No busy/disabled handling — real menu items must respect `busy.has(item.itemId)` and
   `reorder.isPending`.
3. No failure path — a rejected reorder must surface via the existing `reorderError` toast
   (CHANGE-34 pattern), not fail silently.
4. Prototype has no drag handle interaction; drag-to-reorder is untouched by this slice.
