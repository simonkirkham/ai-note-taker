---
name: token-log
description: Record approximate token usage per agent for a completed slice. Append to docs/token-log.md and flag any spikes worth investigating. Triggers include "update token log", "record token counts", "token usage for slice".
---

# Token Log

Record how many tokens each agent consumed in a slice, identify spikes, and surface them for the `process-improvements` skill to act on.

## Step 1 — Collect counts

Read each agent's hand-off summary for an approximate token count. Round to the nearest 1 000. If an agent did not report, record `—`.

Agents: Scout, Breaker, Pip, Stylist, Hawk, Scribe.

## Step 2 — Identify the cost driver

Look at the distribution. The "Why" line should name the dominant driver specifically:

- Not: "the slice was complex"
- Yes: "three rounds of Hawk feedback caused re-implementation by Pip"
- Yes: "Scout loaded six files that weren't needed for the slice scope"
- Yes: "Stylist ran twice after a spec change mid-slice"

## Step 3 — Flag spikes

A spike is any agent whose count is more than double the next-highest agent, or higher than that same agent on the previous slice.

For each spike, note: which agent, roughly why, and what rule or workflow step would have changed the outcome. Pass these to the `process-improvements` skill as inputs — they become TODO or Done learnings entries.

## Step 4 — Append a row to docs/token-log.md

`docs/token-log.md` is one master table, one row per slice. Add a row:

```markdown
| <id> <short name> | <total> | <pip> | <hawk> | <one-line dominant cost driver> |
```

- `Pip` folds Breaker + implementation + orchestration (everything that isn't Hawk).
- `Hawk` folds all review rounds — the recurring spike, so it gets its own column.
- Use the per-agent counts from Step 1 only to compute these two figures; the full breakdown is not stored.

If a slice surfaced a *new* avoidable cost (not already a row in `docs/token-optimisation-playbook.md`), add it there — never as a prose block in the log.

If `docs/token-log.md` does not exist yet, create it with the `# Token Usage Log` heading and table header before appending.

## Done when

Row appended to `docs/token-log.md`; any new avoidable cost added to `docs/token-optimisation-playbook.md`; any spike passed to `process-improvements`.
