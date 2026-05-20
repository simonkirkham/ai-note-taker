# Phase 9 Stylist learnings — Meeting card UX and home layout

## 1. git stash during verification can silently revert in-progress edits

When verifying a pre-existing error (the `@aws-sdk/client-transcribe-streaming` build failure) I ran `git stash`, confirmed the error existed before my changes, then tried to `git stash pop`. The pop failed with a conflict on `App.css`. Rather than resolving the conflict I dropped the stash — unknowingly discarding the `App.css` changes. `ListView.tsx` and `MeetingsSection.tsx` had also been partially reverted by the failed pop without a clear warning.

**Fix:** After any stash operation, run `git diff --stat HEAD` before proceeding. If expected files are missing from the diff, they were reverted.

**Rule:** Never use `git stash` to test pre-existing conditions mid-edit. Instead check out to a throwaway worktree or use `git stash show` to inspect without applying.

## 2. Standalone HTML prototype is the fastest tool for spacing/sizing iteration

CSS spacing and sizing decisions (padding, font-size, button dimensions) are hard to evaluate from code alone. Three rounds of visual feedback — reinstate divider, reduce header/row padding, reduce button size — were resolved in minutes using a single static HTML file. No dev server, no build, just browser refresh.

**Rule:** For CSS-only visual iteration with a real user reviewing, write a self-contained HTML prototype file first. Apply to the real codebase only once the values are confirmed. The prototype file doesn't need to be committed.

## 3. `margin-left: auto` is more robust than `justify-content: space-between` for optional-label rows

The meeting card footer has two layouts: a single-item row (just the action button, no label) and a two-item row (↻ Next label + button). `justify-content: space-between` left-aligns a single item. Switching to `margin-left: auto` on the button ensures it is always right-aligned regardless of whether a label is present — no conditional class needed.

**Rule:** When a flex row has an optional leading element, use `margin-left: auto` on the trailing element rather than `justify-content: space-between`. The latter only works when both elements are present.

## 4. Prototype-confirmed UX spec eliminates implementation back-and-forth

All structural decisions for the meeting card (Style 3 bordered card, R2 action rows, E1/M1 status states, N1 notification banner) were locked in the prototype phase. During the Stylist pass the only open questions were visual refinements (spacing, sizing) — not layout or behaviour. This kept the implementation fast and the review rounds short.

**Rule:** Invest in a thorough prototype approval before the Stylist pass. Structural changes during Stylist = wasted CSS; visual tweaks during Stylist = expected.
