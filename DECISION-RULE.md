# TI-61 — pre-registered decision rule

Written **before** the deciding run. Committed so it cannot be quietly restated afterwards.

## What is being tested

Reordering every navigation wait in `Routing.test.tsx` from *poll-driven on a non-DOM value*
(`waitFor(() => expect(window.location.pathname)...)`) to *mutation-driven on the DOM*
(`findByTestId`), with the pathname then asserted **synchronously**. Both assertions survive
unchanged; only the order and the wake mechanism change.

## Veto — correctness outranks timing

Abandon the reordering outright if **any single** `safe=` reading in the whole run is `false`.

`safe=` asks whether `window.location.pathname` is already the expected value at the instant
the DOM signal fires. The reordering's entire premise is that React Router renders the
destination *because* the location already changed, so the DOM signal cannot precede the URL.
One counter-example falsifies it. Zero tolerance, not a rate — and it is measured on every
transition in the run, not sampled once.

## Effect — measured on durations, not pass counts

**Pass counts are reported but are explicitly NOT the deciding evidence.** The previous run's
2/10 vs 0/10 looked like a win and was consistent with no effect at all (Fisher's exact ~0.24).
Repeating that mistake with a different N is still the mistake.

The deciding measure is per-test wall-clock, which is continuous and where the expected effect
is large (`backPath` was 1735 ms under load against 31 ms unloaded).

Ship the reordering only if:

- **median duration of `Back returns to the home screen` drops by >= 500 ms**, and
- **median duration of `Forward reopens the note` drops by >= 500 ms**,

comparing the reordered arm against the as-is arm in the same invocation.

Below 500 ms the reordering is not buying meaningful margin against a 5000 ms ceiling, so it is
churn dressed as a fix — abandon it and argue the `testTimeout` case on its merits instead.

## Residual — decided in advance too

Even if the reordering passes both bars, if the **worst** observed navigation-test duration in
the reordered arm is still **> 3500 ms** (under 30% margin to the 5000 ms ceiling), the file
also gets an explicit `testTimeout`, and the PR says so rather than implying the reordering
alone closed it.

## What would make me report no fix at all

Veto triggered, and the reordered arm's durations no better than as-is. Then the honest output
is a corrected TI-61 row plus a `testTimeout` change, and no claim that the race was removed.

---

# Result of the deciding run (22:01Z) — reordering ABANDONED

Veto **passed**: `safe=true` on both transitions, ~60 synchronous pathname assertions held.
The premise was sound. The benefit was absent.

| Test | as-is median | reordered median | verdict |
| --- | --- | --- | --- |
| `Back returns to the home screen` | 1760.5 ms | 1881.5 ms | **+121 ms worse** |
| `Forward reopens the note` | 1083.5 ms | 1109.0 ms | **+25 ms worse** |

Bar was >= 500 ms *reduction* on both. Both moved the wrong way, so the rule abandons it.
The head-to-head probe agreed: poll `backWait=165 ms` vs mutation `backWait=199 ms` — the
poll-driven wait was the **faster** one, the opposite of the proposed mechanism. The 1735 ms
`backPath` that motivated it came from a run carrying three other sessions' suites; alone on
the box the same step is 165 ms. It was contention, not the wake mechanism.

**That run also does not count as a green:** 0 failures in 60 as-is tests. It never reached the
failure regime (ratio1 1.06 settle / 1.46 end, against 2.28 with three foreign suites when it
did fail). A green that never had the failing condition proves nothing.

# Pre-registered sizing rule for the timeout fix — written BEFORE that run

There is no race left to remove: every transition is already awaited, and the one available
restructuring is measurably slower. The failing part is a fixed wall-clock deadline on a box
whose effective speed varies 10-56x. A per-test timeout exists to catch hangs, not to assert
machine speed.

- **Inconclusive guard, checked first.** If the worst observed contended navigation duration is
  **< 2500 ms**, the run failed to reach the failure regime again — report it inconclusive and
  size nothing from it. A budget derived from a run that was never contended is a guess wearing
  a measurement's clothes.
- **`testTimeout`** = worst observed contended per-test duration **x2**, rounded up to a round
  number.
- **`asyncUtilTimeout`** = worst observed contended single-assertion wait **x2**, rounded up.
- **Local only**, mirroring the existing `LOCAL_MAX_THREADS` precedent in `vitest.config.ts`.
  CI runs the frontend job alone and is fast; it keeps the defaults, so a genuine hang still
  fails CI on the current budget.
- Both arms **pin their own budgets** so the candidate's raised values cannot leak into the
  control and quietly make it pass.
