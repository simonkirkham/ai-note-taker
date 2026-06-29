# A red shared build is a call to action — not a reason to wait or stop-and-ask

## The failure mode

When the shared deploy gate (or any build) goes **red**, agents recognise it needs fixing — they *know* they should do something — but then **stop and ask the user how to proceed**, or passively **"wait for the owner"** of the failing slice. The asking/waiting *is* the failure. The agent already knows the right action; deferring it stalls the pipeline.

## Why it matters

The main/deploy gate is **shared**. A red gate blocks **every** in-flight slice and **every** parallel session, not just the one that surfaced it. Waiting multiplies the cost across everyone and serialises nothing useful. Throughput depends on red builds being driven green **fast**.

## The rule — default to action

On a red build/deploy:

1. **Diagnose first.** Read the actual failure (`gh run view <id> --log-failed`, per-attempt). Get the *symptom*, not just "it's red".
2. **If it's your change → fix it.**
3. **If it's another slice's failure in the shared gate, it's still yours to drive.** A shared red gate is everyone's problem. Investigate and fix it; "it's not my slice" is not a reason to wait.
4. **If you genuinely cannot fix it,** take a concrete unblock step anyway — re-run a *genuine* flake (with evidence it's flaky, not deterministic), or quarantine-with-a-filed-bug as a last resort — **and** file the high-priority bug. Don't park.
5. **Only stop-and-ask for genuinely destructive or ambiguous calls** — reverting someone's slice, or quarantining in a way that masks a real bug. Asking is the exception, not the default. "Wait for the owner" is a last resort, never the opening move.

## Where this came from

2026-06-26: BUG-39 (37-A's `TodoReorderJourney` reverting after reload, 3/3 deterministic) red-gated the merged-but-undeployed, frontend-only **36-B**. The agent filed the bug correctly — then **stop-and-asked** (wait / investigate / quarantine) instead of just investigating the failure. The correct default was to investigate/fix the red gate (or quarantine-with-the-filed-bug) and keep the pipeline moving, reserving the question only if the fix turned out to need a destructive call.

## Distinct from "is it a flake?"

Re-running is only legitimate for a *genuine* flake — and even then, file it (a flake that surfaced once recurs). A **deterministic** failure (same test, every attempt) is a real bug: re-running masks it and wastes the shared pipeline. Diagnose before you re-run.
