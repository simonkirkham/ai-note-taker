---
name: human-input-log
description: Record every point the pipeline stopped for the human during a slice, and analyse the accumulated log to drive avoidable interruptions down. Capture mode runs as part of Scribe at slice end; analyse mode runs on a cadence or on demand. Triggers include "log human input", "record approvals", "what's interrupting me", "analyse the input log".
---

# Human-Input Log

Track every interruption the human had to handle, classify each, and feed the *avoidable* ones into a fix. The human-cost analogue of [`token-log`](../token-log/SKILL.md). Writes to [`docs/human-input-log.md`](../../../docs/human-input-log.md).

Two modes: **capture** (per slice, run by Scribe) and **analyse** (periodic, the "improve" half).

## How interruptions are captured

| Source | Covers | Mechanism |
|--------|--------|-----------|
| Live hook | **Permission** prompts | Notification hook → `scripts/log-human-input.py` appends to `.claude/human-input-pending.jsonl` (gitignored, per-worktree) |
| Transcript scan | **Gate / Clarification / Decision / Unblock** | This skill reads the session and classifies the rest at slice end |

See the type taxonomy in [`docs/human-input-log.md`](../../../docs/human-input-log.md).

## Capture mode (per slice — Scribe step)

1. **Drain the live permission rows** for this slice's branch:
   ```bash
   python3 scripts/log-human-input.py drain "$(git rev-parse --abbrev-ref HEAD)"
   ```
   Each drained line is one **Permission** row. (Omit the branch arg to drain all pending rows when not in a worktree.)

1b. **Drain the stalls** — the interruptions the transcript scan structurally cannot see:
   ```bash
   scripts/stall-scan.sh 24
   ```
   Each line is one **Stall** row: the human restarting a session that had stopped. These do not look like questions, so step 2 misses every one of them — the log held 1 where the real count was 22. Nearly always `Avoidable? = Yes`; the fix is `CLAUDE.md` → `### When NOT to hand back`, unless the cause is `connection died mid-reply`, which is `No`.

2. **Reconstruct the rest from the session.** Scan this slice's conversation for every point the human was asked for input that the hook does not see:
   - **Gate** — Scout brief / Breaker spec / Pip start / manual `cdk deploy` approval. Record one row; mark `Avoidable? = No`. If the *same* gate fired twice (a decision was re-litigated), that repeat is `Avoidable? = Yes`.
   - **Clarification** — a question raised because the spec or context left a gap.
   - **Decision** — a choice handed to the human between approaches.
   - **Unblock** — the human sorted something out (red build, env var, token, account, manual step).

3. **Classify avoidability + name the fix.** For each non-Gate row, decide `Yes`/`No` and write the concrete fix in the last column (allow-list entry, guardrail, spec-template field, automation). A row with no nameable fix is `No`.

4. **Append rows** to the `## Log` table in `docs/human-input-log.md`, newest slice on top, one row per interruption. If a slice had **zero** interruptions beyond intended gates, add a single summary row (`Slice | Gate | clean run | — | No | —`) so the absence is recorded, not ambiguous.

5. **Graduate avoidable rows.** Pass every `Avoidable? = Yes` row to [`process-improvements`](../process-improvements/SKILL.md) as input — it executes the fix (allow-list/guardrail/rule) in the same turn. Do not leave an avoidable interruption as a log entry only.

## Analyse mode (periodic — the "improve" half)

Run on a cadence (e.g. every ~10 slices) or on demand ("analyse the input log").

1. Read the whole `## Log` table.
2. Tally **avoidable** rows by Type and by root cause.
3. Name the top 1–3 recurring costs in plain language (lead with the concrete change + its value — not bare counts).
4. For each, graduate a concrete pre-emption via `process-improvements` (guardrail / skill rule / permission / spec-template change). Apply it this turn.
5. Confirm the fix is codified in `CLAUDE.md` or the relevant skill — never restate the analysis prose in `human-input-log.md`; the doc points at the codified fix.

## Rules

- One fact per row; follow the `## Writing style` rules.
- The live hook is best-effort — never block on a missing pending file; the transcript scan still runs.
- Gate rows are recorded but are not waste; only a *repeated* gate is avoidable.
- An interruption without a nameable fix is `Avoidable? = No` — do not manufacture a fix to inflate the metric.

## Done when

This slice's rows are in `docs/human-input-log.md`, the pending file is drained, and every `Avoidable? = Yes` row has been handed to `process-improvements` (capture mode) — or the recurring-cost fixes are applied (analyse mode).
