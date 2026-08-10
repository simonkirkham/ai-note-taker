# 51-B — the open-note bar is permanent

Shipped 2026-08-10. PR #452 (`256e4eee`) + gate fix PR #456 (`6f554980`), deploy #757, verified live at note-taker-ai.com.

**What the user got:** open notes stay on screen wherever they are in the app, with the notes list pinned as the first tab. Going home no longer hides everything that was open; opening a note no longer makes a row of tabs appear at once.

**What it cost:** six review rounds, one red deploy, and a merge that shipped nothing.

---

## The headline: a test that had never run

The E2E helper written to guard the new bar **crashed the deploy gate on its first ever execution**. It was authored across six review rounds, reviewed six times, and never once executed — because E2E runs *only* in the deploy gate. Its first run was against `main`.

The crash was a coordinate marshalled from C# into `elementFromPoint`: a non-finite rect component serialises to null, arrives as `undefined`, and Playwright rejects it with `The provided double value is non-finite` — an error naming neither the tab nor the value.

| | |
|---|---|
| Deploy #756 | 1 failed / 29 passed, deterministic. `deploy-production` skipped |
| Consequence | PR #452 merged but **shipped nothing**. Prod unchanged for ~40 min while the block said "Done" |

**The fix that mattered was not the crash fix.** It was discovering that [TI-69] now allows `gh workflow run e2e.yml -f runs=N -f filter=X` against the deployed test env — no deploy, ~2 min a run. Running the "fixed" helper 5× immediately showed **1 pass / 4 fail** for a completely different reason. Without that, the second cause would have cost a second red deploy.

**Rule:** never let a new E2E helper reach `main` unexecuted. Dispatch `e2e.yml` on the branch first. If a helper cannot be run before merge, that is the finding.

## The second cause: asserting through a CSS transition

With the crash gone, the probe still failed 4 runs in 5: `COVERED at 57,73 by NAV sidebar`.

Dropping to a 380px viewport switches the sidebar to `fixed` + `translateX(-100%)` **with a `200ms` transition declared in the same media query**. For those 200ms it genuinely is sliding across the bar. The journey asserted immediately after `SetViewportSizeAsync`.

A viewport change is not instantaneous when a media query it triggers carries a transition. Converge on the settled state; do not sample the animation.

## The pattern that made this expensive

Rounds 3, 5 and 6 each found that **the previous round's fix had broken something else in the same file**:

| Round | Fix | What it broke |
|---|---|---|
| 3 | phone-width offset | placed the media block above the base rule — media queries add no specificity, so it was dead code |
| 5 | `.tab:not(.tabHome):hover` to keep the pinned tab opaque | `:not()` takes its argument's weight → (0,3,0) out-specified `.tabActive:hover`, stripping the page surface from the note being *read*, in all 17 themes |
| 6 | `.tab { max-width: calc(100vw - 13rem) }` | matched `.tabHome` too (truncating "My notes" at ≤322px) and *replaced* rather than tightened the base cap, so tabs grew to 250px between ~432px and 640px |

**What ended it** was not more care. It was making the rules **mutually exclusive by construction** (`:not(.tabActive)`, `:not(.tabHome)`, complementary media queries) so source order cannot flip them — and declaring `left: 0` once instead of per breakpoint.

## Measure, then trust — including the instrument

A working browser was on the machine the whole time (`/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`, reachable from WSL). Two failed attempts were paid for before it was found.

```bash
chrome.exe --headless --disable-gpu --no-sandbox --window-size=W,H \
  --virtual-time-budget=6000 --dump-dom "file:///C:/..."
```

Inline `tokens.css` + the component CSS verbatim, put `data-theme` on a **wrapper div**, write results into a `<pre>`, parse from the dumped DOM. To force `:hover` statically, textually replace `:hover` with a class — a pseudo-class and a class carry identical specificity, so the cascade is preserved.

**Three separate measuring instruments were wrong before any code was:**

1. `getComputedStyle` on a **detached** element returns initial values — every panel read transparent-on-black at a flat 1.00 contrast.
2. Chrome serialises `color-mix()` as `color(srgb r g b)` with **0–1** components, not 0–255 — a light mint read as near-black, and was reported as a fault in the CSS.
3. A poll loop filtered `state == "PENDING"`, but a running check reports `IN_PROGRESS` — it would have declared CI green mid-build.

**Rule:** before believing a green result, inject the defect and confirm the probe goes red. Every measurement in the last three rounds was gated on that control, and it caught all three.

## Scope

The merge treatment repaints `.appContent` from `--color-bg` to `--color-surface` on **every** screen. Measured: `--color-border` *gains* contrast in the 8 light themes and loses it in the 9 dark ones. `--color-border-strong` was generated for all 17 themes (3.01–3.14:1 against each theme's own surface) and applied to the transparent page-level controls that regressed.

~8 transparent bordered rules inside `.appContent` remain on `--color-border` — measured as already far below any threshold *before* this change, so not a regression it introduced. Left deliberately, recorded here rather than silently.

## Links

- Design record: [`web/src/prototype/REFERENCE.md`](https://github.com/simonkirkham/ai-note-taker/blob/prototype/tabs-redesign/web/src/prototype/REFERENCE.md) (`prototype/tabs-redesign`)
- [`e2e-gate-hang-and-the-diagnostic-that-caused-it.md`](e2e-gate-hang-and-the-diagnostic-that-caused-it.md) — why the verdict must exit through the thrown message
- [`deploy-gate-deflake-stacked-causes.md`](deploy-gate-deflake-stacked-causes.md) — a red gate is often several stacked causes; this was two
