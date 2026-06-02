# CHANGE-12 — Drop Notes divider; top-align with Today's Meetings

**Shipped:** PR #123, merge `d0ebaef`, deployed 2026-06-02. Frontend CSS-only.

> **Numbering note:** this shipped as branch `slice/minor-10-home-spacing` / commit *"feat(minor-10): …"* because a concurrent session independently claimed CHANGE-10 ("simplify home screen / smaller buttons") and CHANGE-11 ("preview pull-out flip") in the same backlog doc while this was in flight, overwriting this item's original CHANGE-10 doc entry. Renumbered to **CHANGE-12** (next free) at Scribe; the merged commit/branch keep the "minor-10" name. See the process note below.

## What changed
The home view had a wide blank band under the "Home" title and a heavy 2px divider above the Notes list, because the shared `.note-cards-section` rule carries `margin-top: 2.5rem; border-top: 2px solid; padding-top: 1.5rem` — pushing "Notes" ~4rem below "Today's Meetings" in the right column. One home-scoped override fixes it:

```css
.home-left .note-cards-section {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
```

Now the home "Notes" heading top-aligns with "Today's Meetings" (both columns start at the grid top under `align-items: start`; the two headings share size/weight/transform with `margin-top: 0`), and the divider is gone. **Folder view is untouched** — its `.note-cards-section` renders outside `.home-left`, so it keeps the base spacing + divider.

## Technical notes
- The override mirrors the existing sibling pattern `.home-right-panel .todo-section`, which already zeros the same three properties per-column — internally consistent with how the codebase neutralises that base rule.
- Scoping by descendant selector (`.home-left .note-cards-section`, specificity 0,2,0 > base 0,1,0) changed only the home branch without a new class or touching `ListView.tsx`.
- Top-*edge* alignment was the goal and is achieved; the gap *below* each heading still differs slightly (`.note-cards-heading` vs `.meetings-heading` `margin-bottom`), a pre-existing cosmetic detail left out of scope.

## Process learnings
- **Concurrent sessions editing one backlog doc collide on numbering.** Two sessions both appended a "CHANGE-10" to `phase-minor-changes.md`; last-writer-wins on the shared file silently dropped this item's spec entry while its *code* shipped. The shared `main` checkout makes this likely. **Lesson: when a second session may be working the same backlog doc, claim the next number by committing the Summary-table row + a stub section *first* (small, fast commit) before building, so the slot is reserved; and at Scribe, re-read the doc to detect a collision before assuming your number survived.**
- **A spacing prototype should render the *adjacent* content.** The first gallery explored "space under the Home title" in isolation; the user's real intent was column *alignment* with Today's Meetings — visible only once the neighbour column is in frame.
- **`node_modules` existing ≠ install finished.** Committed once before `npm install` completed (`eslint: not found`); the directory appears early but binaries land later. Wait for the install task to actually complete (or check `node_modules/.bin/eslint`) before trusting the pre-commit frontend gate.
