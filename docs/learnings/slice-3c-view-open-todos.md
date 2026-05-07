# Learnings: Slice 3-C — View open todos on the home screen

## What was inefficient or went wrong

- **Scribe missed the learnings doc and phase-3.md update.** The previous Scribe rounds created `docs/learnings/<slice>.md` and updated `docs/phases/phase-3.md`, but Scribe 3-C only wrote to `workflow-log.md` and `token-log.md`. The pattern isn't captured in the agent instructions — relying on context rather than a checklist.

- **`gh pr merge --squash --delete-branch` fails when local main has diverged.** GitHub merges the PR successfully, but the local post-merge `--ff-only` pull fails when local main has commits not on origin/main. Fix: `git pull --rebase origin main` after the merge command fails.

- **Layer-split boundary: Breaker wrote acceptance specs in Batch 2.** Acceptance specs are thin (~85 lines across 4 tests) and are a direct mechanical translation of the acceptance criteria. Pip can write these as part of Batch 2 implementation rather than having Breaker do them — saves Breaker a read/write cycle.

## Suggested process improvements

- **Scribe checklist should include per-slice learnings doc and phase status update.** Add to Scribe's role: create `docs/learnings/slice-<id>-<name>.md` and update the slice status + acceptance criteria checkboxes in the relevant `docs/phases/phase-N.md`. These are mandatory outputs, not optional.

- **Pip should write acceptance specs as part of Batch 2.** The acceptance spec for a read-only slice is a direct translation of the acceptance criteria — Pip is already reading those to implement the feature. Having Breaker write them separately adds a hand-off round for a task that costs Pip nothing extra.

- **Read large CSS files with `offset`/`limit` in Stylist.** `App.css` is now past 380 lines. Stylist currently reads the whole file to find the insertion point. A targeted read at the known anchor (the "Reduced motion" comment is always the last block) would halve the read token cost as the file grows.

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| None — no `Changes requested` rounds | — | Layer-split + Pip Step 1d pre-PR self-check worked as designed |
