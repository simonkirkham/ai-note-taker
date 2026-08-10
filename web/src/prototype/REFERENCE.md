# Phase 51-A — prototype reference

Locked 2026-08-10. Reference material only. **51-B rebuilds from scratch** on a slice branch using the GWTs in [`docs/phases/phase-51.md`](../../../docs/phases/phase-51.md) — do not copy, cherry-pick or refactor this code.

Run it: `npm run dev` in `web/`, then `/prototype`. `main.tsx` short-circuits before auth/router/providers, so no backend and no sign-in.

## Scope, as corrected during the spike

The brief started as "the tabs on a note screen". The human corrected it on 2026-08-09:

> "The change isn't needed for the tabs in a note. It's the top level tabs. The biggest issue is how they work with home. You click home and they disappear. Then click a note and suddenly all the tabs are back."

So the note's own **Quick notes / Transcript / Final notes** strip is **not changing**. It is rendered unchanged in the prototype only so the bar is judged against a real screen. The phase's original problems 2 and 3 (empty Transcript / Final notes tabs, tabs appearing and disappearing) described that strip and are **dropped, not deferred** — the human said the change isn't needed. Do not re-file them.

## Confirmed design — direction A, "My notes is a tab"

| # | Decision | Note |
|---|---|---|
| 1 | The bar is present on **every** screen — notes list, folder, search, note | This is the fix. It never appears or disappears |
| 2 | The leftmost tab is a pinned **"My notes"** tab with a home icon | Not a document. No close button |
| 3 | "My notes" is **active whenever you are not on a note** — list, folder *and* search | Chosen over a label that follows the destination, and over active-on-list-only. The sidebar already shows which browse screen you're on; the tab is a category marker, and something is always active so the bar has no dead state |
| 4 | Clicking "My notes" goes to the notes list | |
| 5 | The pinned tab is **sticky** at the left while the strip scrolls | With 8 tabs open it must never scroll out of reach |
| 6 | With **zero** notes open the bar still shows, holding only "My notes" | Hiding it would reintroduce the appear/disappear the direction exists to remove |
| 7 | **No line under the bar** | The human called the current `border-bottom` out separately |
| 8 | **Merge · repaint page:** the main content area changes from `--color-bg` to `--color-surface`; the active tab is surface too, so tab and page are one sheet. Inactive tabs sit on `--color-bg` | Chosen over the contained "repaint bar only" variant with the blast radius stated. See the warning below |
| 9 | The recording marker is a pulsing dot at the **left of the tab label** | Design confirmed here; **51-C** wires it to real recording state |

### Rejected, and why

| Direction | Why not |
|---|---|
| **Today (baseline)** | The bug. Included so the round trip could be felt against the alternatives |
| **B · bar always there, no Home tab** | No new concept, but on the list screen no tab is active — the bar sits there representing notes you are not looking at |
| **C · open notes in the sidebar** | Kills the stacked-strips problem outright and cannot flicker, but costs sidebar room and reads as navigation rather than "what I have open" |
| **Merge · repaint bar only** | Same visual idea contained entirely in the bar (band → surface, active tab → bg). Rejected in favour of the fuller repaint |

### ⚠ Decision 8 is app-wide, not a bar change

Repainting the content area touches **every screen** — note, list, folder, search — across **12 themes in light and dark**, and cards lose contrast where surface now sits on surface. It was chosen with that stated. 51-B must budget a Stylist pass and a theme sweep; it is not a one-component change.

## Implementation notes for 51-B

- Today the bar is gated on `activeNoteId` (`web/src/App.tsx:507`) and returns `null` when empty (`OpenNoteTabs.tsx:29`). **Both go.** The bar renders on every route inside `styles.appMain`.
- Once the bar renders off the note route, `reconciled` / `data-tabs-reconciled` matter on the **list** screen too — the restored set is provisional there for exactly the same reason.
- **The pinned tab must not carry `data-testid="open-note-tab"`.** Give it its own testid. Two failures otherwise:
  1. Every count assertion shifts by one.
  2. `AppPage.CloseAllTabsExceptAsync` loops `while count > 1` clicking `open-note-tab-close`. The pinned tab has no close button, so it would spin until the suite timeout — an E2E **hang**, the failure class that already cost a 44-minute gate.
- Keep 49-A's a11y model: a labelled `<nav>` of real buttons with `aria-current="page"`. The pinned tab is just another button. **No ARIA tablist** — merging strips was direction C and was rejected, so the `role="tab"`/`role="tabpanel"` constraint never comes into play.

## Not confirmed — carried out of the spike undecided

The prototype flags notes you already have open in the notes list (an **Open** pill and a left edge on the card). It was never discussed. **Not part of 51-B.** Route to `phase-minor-changes.md` only if the human asks for it.

## localStorage keys

Prototype-only, all namespaced `proto51-`: `proto51-direction`, `proto51-seam`, `proto51-open`. None survive into the real implementation.
