# A gate verdict has an expiry — the window between reading it and acting on it is where it fails

## What happened

`scripts/merge-gate.sh 469` printed `MERGE GATE: GREEN — safe to merge PR #469`, with `MERGEABLE: ok (CLEAN)`. About **three seconds later**, `gh pr merge 469 --squash` was refused: `GraphQL: Pull Request has merge conflicts (mergePullRequest)`. Two commits had been pushed directly to `main` in the gap.

Then the second failure, which cost more than the first: a branch cleanup ran on the assumption the merge had landed. It deleted the remote branch, and GitHub **auto-closed the pull request**. Recoverable — re-push the sha, `gh pr reopen` — but a failed merge had been turned into a closed PR by the step meant to tidy up after a successful one.

Filed as [TI-88](../technical-improvements.md#ti-88-a-gate-verdict-has-an-expiry-and-the-window-between-reading-it-and-acting-on-it-is-where-it-fails).

## Rule 1 — a verdict is a reading, and readings go stale

GitHub computes a PR's mergeability **asynchronously**. Until it recomputes against the new `main`, the API keeps serving the previously-computed `MERGEABLE`/`CLEAN`. So the gate cannot distinguish:

| What it means | What the API says |
| --- | --- |
| Verified clean against current `main` | `MERGEABLE` / `CLEAN` |
| Not yet rechecked since `main` moved | `MERGEABLE` / `CLEAN` |

The check is not wrong about what it saw. It is unable to say **when** what it saw was true, and a merge gate's whole value is that its answer is true *now*.

**The general form:** a check whose output does not name what it was computed against cannot be re-validated by anything downstream. Either close the window (re-run the gate inside the merge step) or make the verdict carry its input (record `origin/main`'s sha at read time and fail closed if it has moved). Both are written up on TI-88; neither is picked here.

**Same shape as [TI-81](../technical-improvements-archive.md#ti-81-an-orphaned-run-record-blocks-the-merge-gate-for-tens-of-minutes)**, which stalled every merge for the best part of an hour on a run record that had stopped being updated. Stale run record there, stale mergeability flag here; different gates, different scripts, one shape. And the same family as [TI-77], where mergeability *not yet computed* was reported as a conflict — TI-77 fixed "no answer yet", this is "an answer that has since expired".

## Rule 2 — never run cleanup on the assumption an action succeeded

Verify the action landed, **then** clean up. Cleanup steps are written for the happy path and are usually destructive (delete a branch, remove a worktree, close a tracking row), so running one after a failure converts a recoverable failure into a harder one. The order is always: act → confirm the effect exists → clean up. Never act → clean up → notice.

## Rule 3 — hearsay must never demote a first-hand reading

A sharper instance landed while this was being written up, and it is worth more than the original finding.

The observation above — watched live, both halves — was relayed to a second session as belonging to a *third* session. That session corrected it. The correction did not travel: ~20 minutes later it arrived back as "the other session raised it, not you". **Nobody had filed anything.** An attribution with no source moved through two sessions and arrived as fact, and it briefly held up filing a real finding.

Two things to take from it:

1. **A claim about who owns something is evidence, not a conclusion.** Confirm it with the named party before acting on it. It costs one message. `CLAUDE.md` already says ownership is always a peer question — this is a clean measurement of the cost of skipping it.
2. **The specific failure mode is that second-hand rumour outranked a first-hand reading.** Watching the gate say GREEN and watching the merge be refused three seconds later is the strongest evidence available. An unsourced "someone else already raised that" is the weakest. When the two conflict, the direct observation wins and the rumour is what gets checked.

The connection to Rules 1 and 2 is not incidental: all three are the same error at different scales — treating a value someone handed you as a fact about the world right now, without asking what it was computed against or when.
