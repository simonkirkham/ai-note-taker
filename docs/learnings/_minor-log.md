# Minor-slice log (Tier 1)

One line per trivial slice that applied a guardrail/permission entry but had no narrative worth a full doc. Tier 2 slices get their own `phase-<id>-….md`; Tier 0 slices get nothing. See `.claude/skills/process-improvements/SKILL.md` Step 2.5.

| Date | Slice | What was applied | Pointer |
|------|-------|------------------|---------|
| 2026-06-04 | tech-remove-dead-dispatcher | Deleted dead `IDomainEventDispatcher`/`IDomainEventHandler` + 5 unused `*EventHandler` classes (never called since `9931d12` inlined projections via an unreviewed direct-to-main "reduce code" commit); corrected CLAUDE.md / architecture.md / ADR 0009 to document inline-in-handler as the real write path. *Why* already captured in `phase-10j` / `phase-12b` learnings — this slice is the resolution. | PR #171 |
| 2026-06-05 | bug-11-session-refresh-token | Merge step ran `gh pr merge` chained after the deploy-gate `echo` in one shell, so it merged while an unrelated deploy (#468) was in-progress — a gate breach (harmless only thanks to `concurrency: deploy, cancel-in-progress:false`). Fix: the merge command must parse `gh run list --json status,conclusion` and abort unless `completed`/`success`; never chain `gh pr merge` unconditionally after the gate check. Full *why* in `phase-bug-11-session-refresh-token.md`. | PR #175 |
