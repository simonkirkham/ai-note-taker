# Human-Input Log

Every point the pipeline stopped for the human, per slice. The human-cost analogue of [token-log.md](token-log.md). Goal: drive down the *avoidable* interruptions over time by feeding each one back into a concrete fix.

Recorded by the [`human-input-log`](../.claude/skills/human-input-log/SKILL.md) skill at slice end (run by Scribe). Permission prompts are captured live by a Notification hook (`scripts/log-human-input.py` → `.claude/human-input-pending.jsonl`, gitignored); clarifications, decisions, and unblocks are reconstructed from the session transcript. Avoidable rows graduate into a fix via [`process-improvements`](../.claude/skills/process-improvements/SKILL.md) in the same turn.

## Type taxonomy

| Type | What it is | Avoidable? | Where the fix lands |
|------|-----------|-----------|---------------------|
| **Gate** | A defined human gate (Scout brief, Breaker spec, Pip start, manual `cdk deploy`) | No — intended | None. Flag only if a gate fires **more than once** per slice (re-litigated) |
| **Permission** | A tool call needed manual approval (sandbox escape, non-allowlisted command) | Usually | `settings.local.json` allow-list / sandbox config |
| **Clarification** | A question raised because the spec/context left a gap | Often | Better default, doc, or a spec-template field |
| **Decision** | "Which of these approaches?" — a choice handed to the human | Sometimes | Codify the heuristic in `CLAUDE.md` |
| **Unblock** | The human had to sort something out (red build, env, token, account) | Often | Guardrail or automation |

The signal is the **avoidable** rows and their root cause. Gate counts are noise unless a gate repeats.

## Log

One row per interruption. Newest slices at the top.

| Slice | Type | What was asked | Why it stopped | Avoidable? | Fix / where it landed |
|-------|------|----------------|----------------|:----------:|-----------------------|
| 42-A | Permission | Repeated tool-approval prompts during the finish (build/test/git) — user twice said "stop asking permissions" | `dotnet build`/`test` write `~/.dotnet`, `~/.aspnet`, `~/.templateengine` (first-run sentinels/telemetry) outside the worktree; not in sandbox `allowWrite` → escaped sandbox → prompted | Yes | Added those paths (+`~/.local`/`~/.config`/`~/.cache`) to `sandbox.filesystem.allowWrite` + `DOTNET_*` telemetry opt-out env in `settings.local.json`; extended [[reference_sandbox_escape_hatch_prompts]] memory |
| human-input-log (tooling) | Decision | Capture mechanism: live hook, Scribe transcript scan, or both | Genuine design fork for a net-new feature; no established default | No | — (legitimate; batched with the row below into one prompt) |
| human-input-log (tooling) | Decision | Analysis loop: auto-graduate via process-improvements, or periodic manual review | Same fork; changed what was built | No | — (legitimate; both asks resolved in a single `AskUserQuestion` call → 1 interruption, not 2) |

## Analysis

Run by the `human-input-log` skill in **analyse** mode (on a cadence or on demand). Tallies avoidable rows by Type and root cause across the whole log, names the top recurring cost, and graduates a concrete fix. Recurring causes and their pre-emptions are codified directly in `CLAUDE.md` guardrails / skill rules — not restated here.
