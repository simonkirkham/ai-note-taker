---
name: work-status
description: Report outstanding work across all phase docs and standing tracks. Reads the numbered phases plus the bugs, minor-changes, model/prompt, and technical-improvements docs and prints what is complete vs. what remains. Triggers include "what's left", "work status", "outstanding work", "what's incomplete", "status report".
---

# Work Status

Produce a factual, no-prose snapshot of outstanding work. Read the docs, classify each item by status, print the report. Do not edit anything.

## Step 1 — Read the sources

| Track | Source | Status cell |
|-------|--------|-------------|
| Numbered phases | `docs/roadmap.md` headers + each `docs/phases/phase-N.md` `## Summary` table | `Done` / `In Progress` / `Not Started` |
| Bugs | `docs/phases/phase-bugs.md` `## Summary` table | `Done` / `In Progress` / `Open` |
| Minor changes | `docs/phases/phase-minor-changes.md` `## Summary` table | `Done` / `In Progress` / `Open` |
| Model & prompt | `docs/phases/phase-model-prompt-improvements.md` `## Summary` table | `Done` / `In Progress` / `Open` |
| Technical improvements | `docs/technical-improvements.md` `## ` section headings | Done/Resolved appears in the section body; else open |

Notes:
- A phase is **complete** only when every slice row reads `Done`. The roadmap header (`_(Done)_`) is a hint, not the source of truth — trust the slice table.
- `technical-improvements.md` has no table. An item is done when its section body starts with **Resolved** / **Done**, or the item was removed. Everything else is open.

## Step 2 — Classify

For each track, split items into complete vs. incomplete. For incomplete numbered phases, list the specific slice IDs not yet `Done` (and their status if `In Progress`).

## Step 3 — Output

Five sections, in this order. Tables, not prose.

### Phases
One table, one row per phase (include `1.5` even though it has no detail doc — its status lives in `roadmap.md`). Take the phase name from the doc's `# ` H1 (strip the `# `).

| # | Name | Status |

- Status is `✅ Complete` when every slice row is `Done`, else `⚠️ Incomplete (done/total)`.

### Incomplete phases — remaining slices
For each `⚠️ Incomplete` phase, reproduce its `## Summary` table reduced to the **unfinished** rows (every row not `Done`), as `Slice | Summary | Status`. Skip this whole section if no phase is incomplete.

### Bugs / Minor changes / Model & prompt
One subsection each. A table of the **open** rows only (`Item | Summary | Status`), then a one-line `N of M done.` tally beneath it. If none are open, write `All N done. No open items.` and omit the table.

> Caution: `phase-minor-changes.md` contains theme-palette tables further down. Only count `CHANGE-*` rows from the `## Summary` table — ignore any row whose first cell is a theme name or `Theme`.

### Technical improvements
One table of **every** item (`Item | Status`), since this doc has no Summary table. Mark `✅ Done` when the section body opens with `Resolved` / `✅ Done` / `Done`, else `Open`. Close with `X open, Y done.`
