# Learnings: Phase 0-B through 0-E — Infrastructure, Acceptance Spec, CI/CD, Dev Loop

## What was inefficient or went wrong

- **Five-role pipeline was not followed.** Scout, Breaker, Pip, Hawk, and Scribe were all collapsed into a single agent stream for every slice. The pipeline is gated by design — each role's output should be reviewed by a human before the next role begins. None of those checkpoints happened. The human had to explicitly ask "are you still following the agent workflow?" before the gap was acknowledged.

- **Scope changes were absorbed without going back through Scout.** The user redirected scope twice mid-session (DynamoDB removed from 0-B; React deferred entirely). Both were good decisions, but the correct response was to pause, update the plan via a Scout pass, confirm with the human, then continue. Instead, the agent updated the plan inline and kept going. The plan and the implementation stayed consistent, but the human had no explicit checkpoint to review the redirected scope before work resumed.

- **No Hawk review on any slice.** The CI pipeline acted as an implicit gate, but no structured code review happened before merge for any of 0-B through 0-E. Issues that Hawk would catch (e.g. the debug `cat outputs.json` step committed to main, the CDK namespace fix that required a re-push) were resolved reactively rather than prevented.

- **Workflow-log and Scribe were forgotten.** Both are mandatory outputs at phase end per the workflow. Neither was produced until the human asked. The agent treated them as optional rather than part of Pip's definition of done.

- **`gh` auth required interactive login mid-session.** Pip's workflow calls for opening a PR via `gh pr create`, but `gh` was not authenticated. The agent attempted it, failed, asked the human to authenticate, then succeeded on the second attempt. This is a repeat of the same issue from 0-A — authentication should be verified at the start of a Pip session, not at the point of first use.

- **Debug artefact (`cat outputs.json`) committed to main.** The debug step was added to diagnose the `API_BASE_URL` extraction issue, which is fine. But it was committed to main and pushed before the deploy ran, meaning it existed in production for one pipeline cycle. A Hawk review step would have caught this before merge.

## Suggested process improvements

- **Pip's definition of done must include workflow-log and Scribe outputs.** Pip should not consider a phase complete until the workflow-log entry is written and a Scribe learnings doc is committed. These should be listed in Pip's hand-off checklist, not left to the human to request.

- **Scout should handle scope changes, not Pip.** When the human redirects scope mid-session (removing a feature, deferring a slice), Pip should stop, flag the scope change, and ask the human to confirm the updated plan before continuing. Pip should not update the plan document directly — that is Scout's artefact.

- **Pip should verify `gh` auth at the start of every session.** Add a `gh auth status` check to Pip's session start. If unauthenticated, flag it immediately rather than discovering it at the merge step.

- **Hawk should review before merge, even for infrastructure slices.** The workflow table lists `Scout → Pip → Hawk → Scribe` for CDK/infra changes. Hawk was skipped entirely for 0-B through 0-E. A lightweight review pass would have caught the debug step and the uncommitted changes before they reached main.

- **Temporary debug changes should be on a branch, not main.** When adding a diagnostic step (e.g. `cat outputs.json`), Pip should keep it on the working branch and remove it before the PR is opened — not add it to main as a follow-up commit.
