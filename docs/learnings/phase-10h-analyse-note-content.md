# Learnings — Slice 10-H: Analyse note content (transcript optional)

Relaxed `POST /notes/{id}/analyse` so analysis runs on note **content** (transcript optional), and added an ephemeral **"Update note content"** switch (default OFF) that gates whether content is rewritten. Tags and action items are always applied.

## The content-rewrite guarantee lives in the handler, not the prompt

The switch is enforced twice: the prompt tells the model to leave content unchanged when the switch is off, *and* the handler refuses to emit `ContentEditedV2` unless `allowContentRewrite` is true. Only the second one is a guarantee — a misbehaving model that returns a rewritten `updatedContent` anyway still cannot mutate the note. The integration test proves this with a deliberately adversarial fake (`UpdateContentFalse` + a "COMPLETELY REWRITTEN BY THE MODEL" payload → content unchanged).

**Rule:** when an LLM output is gated by a user toggle, gate it in the deterministic handler, not only in the prompt. Treat the prompt instruction as a hint and the code check as the contract, and write the adversarial test against the code check.

## Optional minimal-API body = nullable record param + `?? default`

Making the analyse endpoint accept an optional `{ updateContent }` body without breaking the existing no-body callers was done by declaring the handler parameter `AnalyseNoteRequest? req` (nullable complex type ⇒ empty body binds to `null`) and reading `req?.UpdateContent ?? false`. A non-nullable body param would 400 on an empty POST. The existing `PostAnalyse_NoChanges` test (which posts `null`) already exercises the empty-body path, so the safe default is covered.

**Rule:** to add an optional JSON body to a minimal-API endpoint that previously took none, make the parameter a nullable record and coalesce to a safe default — don't introduce a required body and break existing callers.

## Guard parity between frontend and backend: `IsNullOrWhiteSpace`, not `IsNullOrEmpty`

The 422 "nothing to analyse" guard first used `IsNullOrEmpty`, but the frontend gates the button on `content.trim().length > 0`. A note containing only whitespace would have passed the backend guard and burned a Bedrock call on empty input. Hawk flagged the asymmetry; switched to `IsNullOrWhiteSpace` on both content and transcript.

**Rule:** when the same emptiness check exists on both sides of an API, make them agree on whitespace handling — a frontend `.trim()` implies the backend should use `IsNullOrWhiteSpace`.

## "Deployed but the button is missing" was browser cache, not a regression

After deploy the feature appeared absent ("just Record"). The deploy had succeeded *and* invalidated CloudFront, and the merged code was confirmed intact on `origin/main` — the browser was serving a cached `index.html`. A hard refresh fixed it. Verifying the deployed run conclusion + the code on `origin/main` ruled out a regression before touching anything.

**Rule:** for a "missing after deploy" report, confirm (1) the deploy run for the merge commit is `success`, (2) the deploy invalidates CloudFront, and (3) the code is present on `origin/main` — then suspect the browser before suspecting the build. Hashed asset names mean a stale `index.html` is the usual culprit; hard-refresh.

## Discoverability cost of gating a control on content

The Analyse button is hidden until the note has content or a transcript. Combined with the cache issue above, this made the feature look broken on an empty note. Hiding a primary action until preconditions are met trades discoverability for tidiness — worth weighing an always-visible-but-disabled control instead (candidate follow-up).

**Rule:** before hiding a feature's entry point behind a precondition, consider showing it disabled instead — an invisible button is indistinguishable from a broken deploy.

## Slice numbering collides under parallel uncommitted phase-doc work

This slice was numbered 10-H while a *separate, still-uncommitted* 10-G section (in someone else's working tree) had reserved "10-H" for a future `AnalysisApplied` event. Resolved by claiming 10-H here and bumping that deferred reference to 10-I — but only because the collision was noticed. Phase-doc edits that live uncommitted in parallel working trees don't show up in `git log` and silently collide.

**Rule:** before claiming the next slice id, grep the *working-tree* phase doc (not just committed history) for forward references that already reserve it.
