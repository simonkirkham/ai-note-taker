---
name: work-status
description: Report outstanding work across all phase docs and standing tracks. Reads the numbered phases plus the bugs, minor-changes, model/prompt, and technical-improvements docs and prints what is complete vs. what remains. Triggers include "what's left", "work status", "outstanding work", "what's incomplete", "status report".
---

# Work Status

Produce a factual, no-prose snapshot of outstanding work. Read the docs, classify each item by status, print the report. Do not edit anything.

## Step 0 — Pull latest

Run `git pull` first so the report reflects the current state of the docs. A parallel session can advance `origin/main` ahead of the local checkout; reading stale phase docs reports stale status. If the pull fails (e.g. dirty working tree, conflict), note it in one line at the top of the report and continue with the local docs.

## Step 1 — Read the sources

| Track | Source | Status cell |
|-------|--------|-------------|
| Numbered phases | `docs/roadmap.md` headers + each `docs/phases/phase-N.md` `## Summary` table | `Done` / `In Progress` / `Not Started` |
| Bugs | `docs/phases/phase-bugs.md` `## Summary` table | `Done` / `In Progress` / `Open` |
| Minor changes | `docs/phases/phase-minor-changes.md` `## Summary` table | `Done` / `In Progress` / `Open` |
| Model & prompt | `docs/phases/phase-model-prompt-improvements.md` `## Summary` table | `Done` / `In Progress` / `Open` |
| Technical improvements | `docs/technical-improvements.md` `## Summary` table | ✅ **Done** / 🟡 **Partly** / 🔲 **Open** |

Notes:
- A phase is **complete** only when every slice row reads `Done`. The roadmap header (`_(Done)_`) is a hint, not the source of truth — trust the slice table.
- **A row not reading `Done` is not automatically outstanding.** `Deferred`, `Dropped`, `Rejected`, `Reverted`, `Withdrawn`, `Closed (→ …)` and `—` (absorbed into another slice) are all **closed** — count them as closed, name the disposition, and do not report them as work remaining. Only `Open` / `In Progress` / `Not Started` / `Partly` is outstanding.
- `technical-improvements.md` **has** a `## Summary` table (`ID | Item | Status`) and it is the maintained index — read it, not the section bodies. `🟡 Partly` counts as outstanding.

**Read the Summary table by line, not by section.** Rows have been found appended *outside* the table — inside a later item's detail section, where `merge=union` put them when two branches added rows at once. Four such rows (TI-68…TI-71) hid two open items from this report on 2026-08-10. So in every tracking doc, `grep -n "^| \[\?\(TI\|BUG\|CHANGE\|MPI\)-"` and confirm the matched line numbers are **contiguous**; a gap means rows are stranded elsewhere in the file. Report the stranded rows and say where they are. (The optional `\[` matters — some rows lead with a `[BUG-nn]` link rather than bare text, and a pattern without it silently matches a fraction of the table.)

**Fixed bugs may live in `phase-bugs-archive.md`, not `phase-bugs.md`.** When `phase-bugs.md`'s `## Summary` holds only the open rows, take the `N of M done` tally across both files rather than reporting the open count as the whole track.

**A row whose cell text contains a `|` shifts every later column.** In the verbose tracking tables this is common, so never index the status by position from the left — take `cells[-2]` (`Status` is second-from-last, `Depends on` last), or the report silently mis-states status. Do not pattern-match `Open`/`Done` anywhere in the row either: `OpenNoteTabsJourney` in a diagnosis paragraph reads as `Open`.

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
One table of the **outstanding** items only (`Item | Status`), taken from the doc's `## Summary` table — every `🔲 Open` and `🟡 Partly` row, `Partly` first. Close with `X open, Y done (of Z).`
