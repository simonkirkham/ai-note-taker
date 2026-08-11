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
