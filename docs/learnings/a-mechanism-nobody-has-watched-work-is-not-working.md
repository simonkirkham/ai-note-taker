# A mechanism nobody has watched work is not working

## The failure mode

Something is written, reviewed, and merged. It is *believed* to work because it looks right and nothing complained. But nobody has ever pointed at an output it produced — a log line, a run, an emitted event, a refusal. It has never actually executed, and it does not work.

Review cannot catch this class. All four cases below **passed review**. Two passed it six times.

## Four instances, one day (2026-08-10)

| What | Believed | Actually |
| --- | --- | --- |
| `e2e.yml` on-demand runner | The documented way to prove a flake fix without deploys ([CLAUDE.md](../../CLAUDE.md)) | Never parsed. `on:` was never read, so `workflow_dispatch` never registered and **all 162 runs were push-triggered red X's**. Unusable from the day it was added ([TI-69]) |
| Its AWS account guard | Refuses to wipe the event store if pointed at the wrong account | Scoped to a step that never runs the script. Wiped 14 tables **unverified** for 3 days while the repo variable it reads was set ([TI-69]) |
| `recordRumEvent`, 6 slices' worth | Six shipped user signals | Custom events are **DISABLED** on the RUM monitor. None has ever emitted ([TI-67]) |
| 51-B's pinned-tab probe | Reviewed across six rounds | **Crashed on its first ever execution**, red-gating the deploy; the slice merged and shipped nothing while the hand-back said Done |

## Why it matters

The failure is silent *and* self-concealing. A workflow that never parses reports its failure against unrelated pushes. A guard that never runs prints nothing. A telemetry call that never emits looks identical to one with no traffic. So the absence of complaints is not evidence — it is the symptom.

Worse, each one degraded a *safety* mechanism, and the belief that it existed is what removed the pressure to check.

## The rule

**Before recording anything as working, name the observation that proves it.** Not the code, not the review, not a green build that never exercised it — the output.

- Added a guard? Make it **fire once** and read the line. `Target account … matches E2E_TEST_ACCOUNT_ID.`
- Added telemetry? Query the sink, in the environment that matters, and find the event.
- Added a workflow, script, or helper? **Run it.**
- Cannot observe it? Then it is unverified — say so plainly rather than reporting it as done.

## The checkable test

> *Can I point at something this produced?*

If the honest answer is "it should work" or "it was reviewed", it is unverified. On 2026-08-10 that question, asked once, was the entire difference between finding three defects and shipping past all of them.

## Where the cost lands

Verifying costs minutes. The `e2e.yml` defect went 3 days and 162 false red marks, and was first written up with a **confidently wrong cause** inferred from run metadata — because the run list can describe runs, and the thing that never happened leaves none. See the 2026-08-10 entry in [`_minor-log.md`](_minor-log.md).

## Distinct from "test it"

This is not a call for more tests. Three of the four had tests, or were themselves test infrastructure. It is narrower: **the first execution of a new mechanism must be watched by a person, once.** After that, tests carry it.
