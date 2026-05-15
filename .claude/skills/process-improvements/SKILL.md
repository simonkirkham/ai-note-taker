---
name: process-improvements
description: Surface observations from a completed slice and write them as actionable learnings. Execute any immediately-actionable improvements (config fixes, guardrail updates, permission entries) in the same turn. Triggers include "write learnings", "process improvements", "retrospective", "what can we improve".
---

# Process Improvements

Surface observations from the completed slice and turn each one into a concrete action. If the action can be applied in this turn, apply it now — don't leave executable improvements as suggestions.

Runs as part of Scribe after deploy, but can be invoked independently at any point during or after a slice.

## Inputs

- The completed slice (files changed, git diff, or a description)
- Any token spike observations passed from the `token-log` skill
- Any agent hand-off notes that mention friction, rework, or unexpected steps

## Step 1 — Run the permission audit

Diff `.claude/settings.local.json` against main. New entries = commands that required manual approval during the slice.

For each new entry decide:
- **Safe and commonly needed** → add to the allow-list permanently.
- **Replaceable with an existing pattern** → update the guardrail in `CLAUDE.md` or role rule in `agent-roles.md` so future runs use the right pattern. Examples: `npm --prefix web run build` instead of `cd web && npm run build`; `gh pr create --body-file .pr-body.md` instead of a variable assignment.

Apply all fixes now. Each fix becomes a Done entry in the learnings doc.

## Step 2 — Identify observations

Scan the slice for anything worth capturing. Cast wide — any of these areas is fair game:

| Area | What to look for |
|------|-----------------|
| Workflow | A role caused rework, a hand-off was unclear, a step was skipped |
| Code | A repeated pattern that a new smell rule or guardrail would prevent |
| Project | A structural, tooling, or config change that would help future slices |
| Permissions | Gaps found in Step 1 |
| Token usage | Spikes passed in from the `token-log` skill |

Only record observations where you can name a concrete next action. An observation without an action is noise.

## Step 3 — Write the learnings doc

Create `docs/learnings/phase-<n><id>-<short-description>.md`. Check existing files in `docs/learnings/` to match the naming convention exactly before creating.

**Format:** one bullet per observation.

```markdown
# Learnings: <slice name>

- <Observation.> **Action:** <what to do> — Done.
- <Observation.> **Action:** <what to do> — TODO.
```

- **Done** = you can apply it in this turn. Do it, then mark Done.
- **TODO** = requires a human decision (architectural change, new tool, process redesign).

**Examples:**

```markdown
# Learnings: 4-E Note summary cards

- Pip ran `cd web && npm run build`, which required a manual approval and broke the run. **Action:** Added `Bash(npm --prefix web run build)` to the allow-list and added a guardrail to CLAUDE.md — Done.
- Scout read the full event-model.md but only needed the NoteCreated shape; this loaded ~400 unnecessary lines into context. **Action:** Scout should scope reads to the specific aggregate section rather than the full model — TODO.
- Pip (~48 000 tokens) was 3× Scout's count. Root cause: three rounds of Hawk feedback caused re-implementation. **Action:** Breaker should validate the spec against the phase doc acceptance criteria before handing off to Pip — TODO.
```

## Step 4 — Execute all Done actions

Before committing, apply every action marked Done:

| Action type | Where to edit |
|------------|--------------|
| Permission entry | `.claude/settings.local.json` allow-list |
| Guardrail | `CLAUDE.md` Guardrails section |
| Role rule | `.claude/skills/.agent/generic/agent-roles.md` |
| Skill rule | The relevant `SKILL.md` |

Re-read the learnings doc after applying to confirm every Done label is accurate.

## Step 5 — Append an applied-status table to the learnings doc

After all Done actions are applied, add an `## Applied status` section at the bottom of the learnings doc. One row per learning:

```markdown
## Applied status

| Learning | Status |
|---|---|
| 1. <learning title> | Applied — <where/how> |
| 2. <learning title> | Applied — <where/how> |
| 3. <learning title> | Documented — <why not applied yet> |
```

- **Applied** = change was made in this session (with pointer to where)
- **Documented** = captured for future reference; not executable now (explain why)
- **TODO** = requires human decision; not applied yet

This table is the audit trail that answers "were the learnings from this slice acted on?" in the next session.

## Rules

- Observations without a concrete action are not learnings — omit them
- If an action is immediately executable, execute it; never leave it as a suggestion
- Do not suggest anything that contradicts a guardrail in `CLAUDE.md` without flagging the conflict explicitly
- Do not change feature code, tests, the event model, or CDK stacks
- Keep entries brief — one tight sentence per observation is enough

## Done when

Learnings doc is written, all Done actions are applied, and you have a list of TODO items to surface to the human.
