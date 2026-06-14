# Authorizing on an async projection, and a night lost to the wrong AWS account

**Date:** 2026-06-13/14 · **Items:** BUG-30 (the bug), the residual deploy-gate flake after TI-39 · **Deploys:** #575–#584

## One-line lesson

**Never authorize (existence/ownership) against an eventually-consistent read model.** After the RYW async-projection migration, every note-scoped handler still checked ownership via the `NoteDetail` *projection*, which the projector now builds asynchronously — so any operation firing shortly after create 404'd "note not found" while the projector lagged. Authorization must read a **strongly-consistent** source (the event stream).

## The bug (BUG-30)

| | |
|---|---|
| Symptom | Rotating deploy-gate flakes; `[api-fail]` showed `PATCH /date`, `/title`, `/tags`, `GET/POST /actions` → **404** on freshly-created notes under the E2E write burst |
| Cause | Handlers did `noteDetailStore.GetAsync(noteId)` → 404 on null. `NoteDetail` is async (27-RYW); not built yet right after `POST /notes` → null → 404. Event stream had the note all along (`ConsistentRead`). |
| Fix (writes) | `NoteCommandHandler` + a shared `INoteAuthorizer` authorize from the **event stream** (owner = UserId on the note's first event). Command Lambda has event-store access. |
| Fix (GetActions read) | Query Lambda has **no** event-store access (27-D) → the authorizer 500s there → kept the projection check + a **bounded re-poll** for the cross-stream race |
| Invisible because | prod is single-user (no burst → no lag), and the E2E env is a **separate AWS account** |

## Lessons that generalize

1. **Authorization/existence must be strongly consistent — never an async projection.** When you migrate a read model from inline to async (CQRS/streams), audit every handler that *reads it to make a decision* (auth, existence, conflict), not just the ones that return it. They silently become racy. Here, ~15 handlers across 4 files inherited the bug from one migration.

2. **Know which account/environment you are observing — verify, don't assume.** An entire night went into querying CloudWatch (`--profile prod`), finding everything healthy — because the deployed **E2E env (`d33j7ydhvhedrn`) is a different AWS account** than `--profile prod` (`642653037268` = `note-taker-ai.com`). The flake lived in an env I had no creds for. **Before trusting any log/metric, confirm the resource belongs to the environment under test** (resolve the stack's `WebUrl`, check the distribution/account).

3. **When you can't reach an env's server logs, route the evidence through a channel you *can* read.** The breakthrough was a Playwright `Response` listener (`AppPage`) that printed every failing `/api` response to the test console + `--logger detailed`, surfacing the separate-account env's failures **into the gh run log**. Make the invisible visible through the test harness.

4. **DynamoDB Streams do not guarantee cross-key ordering.** `GetActions` gated on the *action* stream's position but read ownership from the *note* projection — a different key. The action event can be folded **before** the note event → the gate releases but `NoteDetail` is still null → spurious 404. Gating on stream A while reading a projection built from stream B is a race. (Workaround: bounded re-poll; the proper fix is a same-stream or strongly-consistent check.)

5. **The Command/Query Lambda split means read handlers can't touch the event store.** The event-stream authorizer fixed the writes (Command Lambda) but **500'd** the `GetActions` read (Query Lambda, least-privilege IAM = projection-read-only). **In-process `Api.Integration` runs a single host without the 27-D split, so it can't catch a read handler reaching for the event store** — only E2E against the real split Lambdas did. Coverage gap worth an Infrastructure.Assertions or smoke check.

6. **Process — autonomous rerun loops must be strictly sequential.** Fire-and-forget 8×-parallel rerun loops jammed the shared CloudFormation deploy stack-lock; a deploy queued ~4 h behind the storm (read as a "hang"). Reruns to measure a flake rate must run **one in flight at a time** (wait for the previous to complete before triggering the next).

## Method that worked (once the blindspot was fixed)

Add `[api-fail]` logging → read it on each flake → the 404 paths localized the bug to "handlers authorizing on the projection." Fix writes (event stream) → re-measure → only `/actions` 404 remained → that exposed the cross-stream race → fix → **6/6 controlled green.** Evidence each step; no fix shipped on assumption.

## Follow-ups

- Image/transcription write handlers share the projection-auth anti-pattern (latent — not exercised right-after-create yet). Apply the same `INoteAuthorizer`.
- An Infrastructure.Assertions/smoke check that a read-path handler never depends on event-store access (would have caught the GetActions 500).
- `NoteImage.Remove` projector-lag-tail watched but did not recur in the converged runs.
