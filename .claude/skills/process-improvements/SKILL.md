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
- Any **`Avoidable? = Yes` human-input rows** passed from the [`human-input-log`](../human-input-log/SKILL.md) skill — each names a fix (allow-list entry, guardrail, spec-template field, automation); execute it this turn like any other Done action
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

## Step 2.5 — Decide the tier

Not every slice earns a full learnings doc. The doc does two jobs — **(A)** force the guardrail/permission extraction (Steps 1 & 4) and **(B)** preserve a narrative of *why*. Tiering scales **B only**; **A always runs**, at every tier.

Answer two questions:

- **Q1 — Did anything get *applied* that changes future agent behaviour?** A new/changed guardrail, role rule, skill rule, or permission entry.
- **Q2 — Is there a non-obvious *why* worth preserving?** A bug root cause, a tradeoff or spec deviation, a near-miss, a *class-level* Hawk finding, or a token/workflow process change. **Adding a guardrail is always Q2-yes** — the reasoning behind it must be auditable.

| Q2 | Q1 | Tier | Output |
|----|----|------|--------|
| Yes | either | **2 — full doc** | `phase-<n><id>-….md` per Step 3 below |
| No | Yes | **1 — stub** | One dated line appended to `docs/learnings/_minor-log.md` (what was applied + pointer to the commit/guardrail); skip Step 3. In practice Tier 1 is reachable only when the sole applied change is a bare permission-allow entry — any guardrail/role/skill-rule change is Q2-yes (Tier 2) |
| No | No | **0 — none** | No file. The PR + git history is the record; skip Step 3 |

State the tier in one line before proceeding, e.g. *"Tier 0 — pure CSS slice, CI green first try, no guardrail, no permission gap → no doc."* or *"Tier 1 — added one permission-allow entry, no guardrail, nothing non-obvious → one line in `_minor-log.md`."*

Litmus test: *would a future agent change its behaviour because this prose exists?* If the only honest answer is "they'd re-read what they already know from CLAUDE.md or git," it is Tier 0/1. **"No learnings doc" is a valid, expected result for a trivial slice — never manufacture observations to justify a file.**

## Step 3 — Write the learnings doc (Tier 2 only)

Create `docs/learnings/phase-<n><id>-<short-description>.md`. Check existing files in `docs/learnings/` to match the naming convention exactly before creating.

**Format:** one bullet per observation.

```markdown
# Learnings: <slice name>

- <Observation.> **Action:** <what to do> — Done.
- <Observation.> **Action:** <what to do> — TODO.
```

- **Done** = you can apply it in this turn. Do it, then mark Done.
- Before filing anything as **TODO**, check it is not a peer question — ownership, whether another session already fixed it, whether a guardrail is already in flight elsewhere. Ask via `SendMessage` first; the human is the last resort (CLAUDE.md `### When NOT to hand back`, rule 5).
- **TODO** = requires a human decision (architectural change, new tool, process redesign).

Example bullet: Pip ran `cd web && npm run build`, which needed manual approval and broke the run. **Action:** added `Bash(npm --prefix web run build)` to the allow-list + a CLAUDE.md guardrail — Done.

## Step 4 — Execute all applied actions

Runs at **every tier** — this is job (A), and it never gets skipped. Apply every guardrail/permission/rule change the slice produced:

| Action type | Where to edit |
|------------|--------------|
| Permission entry | `.claude/settings.local.json` allow-list |
| Guardrail | `CLAUDE.md` Guardrails section |
| Role rule | `.claude/skills/.agent/generic/agent-roles.md` |
| Skill rule | The relevant `SKILL.md` |

For **Tier 2**, the source of these actions is the learnings doc — re-read it after applying to confirm every `— Done` label is accurate. For **Tier 0/1** there is no doc; apply the Step 1 permission/guardrail fixes directly, and for Tier 1 record the applied change as the one-line `_minor-log.md` entry.

## Step 5 — Append an applied-status table to the learnings doc (Tier 2 only)

Add the `## Applied status` table **only when status is genuinely mixed** — some Done, some Documented/TODO. If every learning already ends in an inline "— Done", the table just re-lists the bullets; omit it.

When it earns its place, add an `## Applied status` section at the bottom of the learnings doc. One row per learning:

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
- **Open every observation with the cost, not the mechanism.** The first clause says what it cost — the human's time, a wrong decision, a silent failure, a wasted deploy — before naming any file, function, log group or event. A learnings doc exists to change a future decision; one that opens on machinery buries the only part that does that. Same rule and same checkable test as `## Writing style` in `CLAUDE.md`.

## Done when

The tier is stated; for Tier 2 the learnings doc is written (for Tier 1 the `_minor-log.md` line is appended, for Tier 0 no file); all applied guardrail/permission/rule changes are in place; and you have a list of TODO items to surface to the human.
