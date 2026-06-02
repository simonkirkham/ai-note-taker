# CHANGE-6 — Collapsible "Filters" control for home tags

**Shipped:** PR #111, merge `d509ce3`, deployed 2026-06-02. Frontend layout/interaction only.

## What changed
On the home view, the `TagFilter` moved from the top of the `home-left` column into the Notes section behind a "Filters" toggle that defaults to collapsed. `ListView.tsx` gained component-local `filtersOpen` (`useState(false)`, not persisted); the toggle exposes `aria-expanded` + `aria-controls="home-filters-panel"` over a `hidden`-gated panel that conditionally renders the unchanged `<TagFilter />`. When collapsed with tags selected it shows a `Filters (N)` count plus an `--active`/rotating-chevron affordance. The old top-of-column render was removed (no duplication). Folder view is untouched. New `CollapsibleFilters.test.tsx` (9 tests) covers default-collapsed, expand/collapse, aria wiring, active-count, composition with the CHANGE-3 date filter, and folder-view-unaffected.

## Technical notes
- Filter state (`selectedTags`/`filterMode`) lives in `ListView`, not `TagFilter`, so unmounting `TagFilter` on collapse never loses the selection — the count and the filtered list both survive collapse. Proven end-to-end by the date-filter composition test.

## Process learnings — running three minor slices in parallel

CHANGE-5, CHANGE-6, CHANGE-7 ran concurrently in separate worktrees. Two things bit, both worth remembering:

1. **Concurrent edits to a shared file (`App.css`) cause predictable merge conflicts — design for it.** All three slices appended to `App.css`. Each used a clearly-delimited, self-contained region (`/* === CHANGE-N … (start/end) === */`) appended at EOF and referencing only design tokens. This made resolution mechanical: whichever slice merged later took the other's `App.css` wholesale (`git checkout --theirs`) and re-appended its own block — no hand-merging of interleaved hunks. Conflicts still occurred (the shared `:focus-visible { outline … }` declaration tricked git into interleaving), but the take-theirs-and-reappend recipe sidestepped them entirely. **Lesson: when parallel slices must touch one CSS file, give each a fenced EOF region and resolve by reappend, not by hunk.**

2. **Don't run a slice as a background sub-agent *and* take it over in the main loop — they collide on the shared worktree's git state.** When a slice sub-agent stalled, the orchestrator took over the same worktree; the sub-agent was still alive and later did a `git rebase`/reset that clobbered the orchestrator's merge commit, leaving a confusing mix of dangling stashes, a reset HEAD, and a transiently-empty `git diff`. Recovery was a clean `git reset --hard origin/<branch>` to the last pushed good commit, then redo the merge. **Lesson: a slice has exactly one driver. If you take over a sub-agent's worktree, treat the sub-agent as dead and don't expect its further actions to be inert — and prefer resetting to the pushed remote commit over trusting a locally-churned working tree.**
