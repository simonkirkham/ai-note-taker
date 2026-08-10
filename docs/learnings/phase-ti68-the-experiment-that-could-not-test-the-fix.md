# TI-68 — the fix that was silently a no-op, and the experiment that could not have tested it

**Slice:** TI-68 + BUG-69 (PR #455, deploy #758, 2026-08-10). 19 lines of config. ~85% of the cost went on evidence, not on the change.

**What it cost before the fix:** committing frontend work on WSL blocked 5 consecutive attempts during 51-B and burned ~90 minutes without once finding a real fault — `Test timed out in 5000ms` on files that cannot fail for a real reason, including a pure string function with no async in it. The gate exists to catch defects and was catching itself. Worse, `--no-verify` is forbidden, so an agent was stuck between a rule and an unusable gate — the state that trains agents to bypass the guard the rule is protecting.

---

## 1. The prescribed fix was removed from the tool and is accepted silently

TI-68 specified `poolOptions.vmThreads.maxThreads`. **Vitest 4 removed it and accepts it as a deprecated no-op.** Written that way the cap looks configured, reviews as correct, passes every test, and never applies.

It surfaced only because a throwaway single-file run printed a deprecation line that a full run would have buried. The live option is top-level `maxWorkers`.

**This is the fourth instance of the same shape in one day** — [BUG-65]'s guards that could not fire, [TI-67]'s RUM events that never emitted, [TI-69]'s account guard that was inert while the workflow wiped the event store, and this. The class: *a setting or guard that is syntactically accepted, semantically ignored, and indistinguishable from a working one without executing it and reading the output.*

**Generalisable rule:** a tracking row's prescribed fix is a hypothesis with an expiry date. Before implementing one written against a dependency, confirm the option still exists in the installed version. Cheapest possible check: run the smallest thing that exercises it and read the warnings.

## 2. The obvious experiment could not have tested the fix

The plan was two sessions running the full suite concurrently, both capped — "does it survive contention?". Both runs came back green and it proved nothing.

**Two capped runs are 2+2 = 4 workers on a 16-core box. That is not a contended condition.** The cap removes the over-subscription that *is* the mechanism, so a capped-overlap experiment cannot reproduce the failure by construction. Two green runs were the expected result, not evidence.

The claim had to be reframed to one the data can carry:

- ❌ "capping survives contention" — untestable, and was never tested
- ✅ **"capping prevents the contention"** — proved by asymmetry

| Condition | Runs | Result |
|---|---|---|
| Uncapped + contended | 3, across 2 sessions | 8 failed/1214s · 33 failed/835s · 12 failed/1204s |
| Capped | 7 | **0 failures**, incl. one at load 14.29 and one through the commit hook first time |

**Generalisable rule:** before running an experiment, ask what result would *disconfirm* the hypothesis. If the setup makes the failure unreachable, the experiment is decoration — and two green runs will be read as proof by whoever finds them later. That sentence is now in the TI-68 row so nobody re-runs it in six months.

## 3. Three experiments were destroyed before one worked, two by us

1. **An unscoped `pkill -f "vitest run"` killed a peer session's run** in a different worktree — the pattern matches any process on the machine. The peer then diagnosed the death as out-of-memory and proposed re-scoping the whole approach around a ceiling that did not exist. Disproved by measurement: 4771 MB free, zero swap, no OOM entries, and my own run still alive. **Kill by PID from the specific worktree, never by pattern, on a shared machine.**
2. **A peer's run executed from the repo root under the node environment** — `cd web && ( … ) & npx vitest run` backgrounds the whole `cd &&` chain, so the foreground shell never left the root. Signature: `ReferenceError: window is not defined`, `setup 0ms`, and a file count wider than the real suite.
3. **A pairing was doubted on a duration inference** that was right to raise and wrong in fact — a launch timestamp was quoted as a start timestamp. The timestamps settled it; the inference could not.

Common thread: **every one of the three was diagnosed confidently from a single datum, and two of those diagnoses were wrong.** Both were caught by checking rather than accepting.

## 4. BUG-69 needed no fix of its own

Its symptom — `OpenNoteTabs.test.tsx` aborting the gate — is the same root cause, and its own analysis had already concluded the direction was bounding concurrency rather than raising its 1000 ms budget. Its 27 tests pass in every capped run. **No edit to the test file**, which mattered: 51-B was rewriting it concurrently.

## Applied status

| Action | Status |
|---|---|
| `web/vite.config.ts` — `maxWorkers` cap, both traps documented inline | Done (#455) |
| TI-68 row — corrected fix, plus what the evidence can and cannot prove | Done |
| BUG-69 — closed, with the "no test-file change needed" reasoning | Done |
| `CLAUDE.md` `## Writing style` — lead with the user's experience, checkable test | Done |
| `CLAUDE.md` rule 1 + `### Human gates` — three classes that only look like decisions | Done |
| `CLAUDE.md` rule 7 + `scribe` SKILL — a partial procedure is not a complete one | Done |
