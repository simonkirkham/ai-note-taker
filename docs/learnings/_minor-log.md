# Minor-slice log (Tier 1)

One line per trivial slice that applied a guardrail/permission entry but had no narrative worth a full doc. Tier 2 slices get their own `phase-<id>-….md`; Tier 0 slices get nothing. See `.claude/skills/process-improvements/SKILL.md` Step 2.5.

| Date | Slice | What was applied | Pointer |
|------|-------|------------------|---------|
| 2026-06-04 | tech-remove-dead-dispatcher | Deleted dead `IDomainEventDispatcher`/`IDomainEventHandler` + 5 unused `*EventHandler` classes (never called since `9931d12` inlined projections via an unreviewed direct-to-main "reduce code" commit); corrected CLAUDE.md / architecture.md / ADR 0009 to document inline-in-handler as the real write path. *Why* already captured in `phase-10j` / `phase-12b` learnings — this slice is the resolution. | PR #171 |
