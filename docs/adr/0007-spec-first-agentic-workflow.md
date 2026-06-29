# ADR 0007 — Spec-first agentic workflow with skills, not role agents

**Status:** Accepted

## Context

Prior experience used a team of role-based specialist agents (research, test writer, coder, reviewer) coordinated per slice. That works but the orchestration overhead grows with the team size and the agents tend to be over-prescribed for what the task actually needs.

Two evolutions are possible:

- **Refine the role-team approach** — better prompts per role, more handoff structure.
- **Move from roles+tasks to specs+capabilities** — let the agent decide the decomposition, you provide the success criterion (a spec) and the tools (skills).

## Decision

Adopt a **spec-first agentic workflow** built on Claude Code with reusable **skills** instead of static role-prompt agents.

The loop per slice:

1. Update event model with the new Given/When/Then.
2. Write the BDD spec.
3. Hand the spec to the agent — success criterion is *spec green*.
4. Review the diff, not the steps.
5. Append a reflection note to `docs/workflow-log.md` at end of phase.

## Consequences

- Skills (`.claude/skills/`) replace per-role prompts: `event-modelling`, `aggregate-command`, `projection`, `dynamodb-event-append`, `cdk-stack-update`. Skills are loaded on demand — cheap when not used.
- `CLAUDE.md` provides session orientation; skills carry the deep capability content.
- Plan mode and `/review` (or a review subagent) act as gates.
- Hooks enforce: BDD specs green, `cdk synth` succeeds, no direct DynamoDB writes outside the event store layer.
- Workflow style varies deliberately across phases (prompt-and-review → spec-and-delegate → autonomous loop) so we learn the spectrum, not just one mode.

## Alternatives considered

- **Continue with role-based specialist agents** — proven but a sideways step rather than forward.
- **Single monolithic agent driving everything** — loses the discipline of structured gates and skill reuse.
