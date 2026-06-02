# CHANGE-8 — Theme picker + Sign out always visible without scrolling

**Shipped:** PR #119, deployed 2026-06-02. Frontend CSS-only.

## What changed
The sidebar footer (theme picker + Sign out, pinned by `margin-top: auto`) was pushed below the fold once the folder tree made the sidebar taller than the viewport — the desktop sidebar is a grid item with no capped height and no internal scroll, so it grew the document. Fix, in `web/src/App.css`:
- `.sidebar` — `position: sticky; top: 0; height: 100vh` so the desktop sidebar is viewport-bound.
- `.sidebar-folders` — `flex: 1; min-height: 0; overflow-y: auto` so only the folder list scrolls.

Mobile is unaffected: the `@media (max-width: 639px)` sidebar is `position: fixed; top: 0; bottom: 0`, so `position: fixed` overrides `sticky` and it stays full-height.

## Technical notes
- `min-height: 0` on the flex child is load-bearing (lets `.sidebar-folders` shrink below content height so it scrolls instead of growing the sidebar) — the same trick as CHANGE-4's to-do wrap.
- `height: 100vh` + the sidebar's `padding` is safe because of the global `box-sizing: border-box` reset.
- `position: sticky` works on the CSS-grid sidebar item: the grid row is `min-height: 100vh` and grows with the taller main column, giving the sticky element a scroll range; when content is shorter, nothing scrolls and the footer is visible.
- Pure CSS, so no jsdom-testable behaviour — coverage is the full existing suite staying green (248/248), per the CHANGE-1 precedent. A future `Browser.E2E` assertion (long folder list → footer in viewport) could guard against regression.

## Process
Sequential after CHANGE-5/6/7; first-pass Hawk approval, no rework. Doing this tiny CSS slice inline in the main loop (rather than spawning a sub-agent) avoided the one-driver-per-slice collisions seen in the earlier parallel batch — see [[phase-minor-6-collapsible-filters]].
