# 27-C — Async cutover: attempted, reverted, and what it taught

**Slices:** 27-C (PR #250) + 27-C2 frontend (PR #251), **reverted** by PR #252 · deploys #540/#541 red, #542 green on revert · 2026-06-11/12.

## What happened

27-C removed the inline projection writes so the async Projector Lambda (27-B) became the **sole** read-model writer → read-after-write became eventually consistent. The deploy E2E failed. After a long diagnosis it was reverted to inline immediate-consistency; the projector stays deployed but its stream trigger is **disabled** (it would double-write the increment feedback counters while inline is authoritative).

## The headline lesson

**The async projectors were the easy part. The read-after-write contract with the client is the actual work of async event sourcing.**

The backend cutover and the projector were correct and healthy (the test-account projector processed the stream at ~1s lag, 0 errors). What broke was that **the frontend was built on an immediate-consistency assumption**: it reads server truth after navigation and reconciles writes by *refetching a projection*. Under async, every one of those refetches raced the ~1s projector lag, got stale data, and stuck (React Query marks a stale 200 as fresh — no auto-retry). Patching it was whack-a-mole: distinct races across `keys.noteCards`, `keys.note`, and `keys.actions`, each across several mutations, and the first fix pass even introduced a regression (removing a reconcile without fully replacing it → new notes stopped appearing in the list).

The right fix is **not** per-mutation optimism sprinkled reactively. It is a **read-your-writes foundation** (slice **27-RYW**): a command returns the stream position it wrote; a read can request "consistent as of position N" and the query side waits until the projection reaches N. That makes read-after-write deterministic — no magic timers, no per-mutation cache surgery — and only then does the cutover become a non-event.

## Diagnostic mistakes worth remembering

1. **I diagnosed the wrong environment first.** The prod account (`--profile prod`, 642653037268) is idle and was still on 27-B; its projector showed "No records processed" + 0 invocations, which I read as "the projector is broken." It wasn't — it was idle. The E2E failed in the **test** account (`--profile test`, 739754704263), where the projector was healthy and running. **Lesson: confirm which environment the failing signal came from before diagnosing; deploy-test and deploy-production are separate AWS accounts (env-scoped GitHub secrets).**
2. **An empty stream shard ≠ a broken ESM.** "No records processed" on an enabled ESM over an *idle* stream is expected, not a fault. I burned time adding a temporary `ListStreams` IAM grant to chase a permissions theory that the idleness made untestable.
3. **Iterator-age is the right "is it lagging?" signal** — it was ~1s at the failure moment, which *ruled out* lag and pointed at correctness/client behaviour instead.

## The sequencing mistake (the real root cause of the whole detour)

27-C flipped the consistency model **before** anything gave the client read-your-writes. The phase plan's premise — "the frontend's optimistic updates already mask the lag" — was only half true: optimism masks the *same view*, not a *different view after navigation*. The cutover should have been **gated on 27-RYW**, not attempted first. The phase doc + ADR 0009 now encode that dependency.

## What was kept (so this wasn't wasted)

- **27-A `ProjectionUpdater`** and **27-B Projector Lambda + stream + DLQ + position guard** remain deployed. The event-sourcing artifact — a replayable async consumer of the log — exists in prod, dormant, re-enableable in one flag (`Enabled = true`).
- The ADR/phase docs carry the honest record and the 27-RYW path forward.

## If 27-RYW re-enables the projector
Re-add the `FolderDeleted`/`WorkspaceDeleted` arms to `ProjectionUpdater` (the revert removed them; under inline the handlers delete the rows directly). Otherwise the async path won't cover folder/workspace deletes. Flagged in the ADR gate.
