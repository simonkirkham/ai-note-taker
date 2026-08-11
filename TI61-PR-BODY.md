# TI-61 — a routing test rejects your commit when the box is busy

**A local commit gate fails on a test you did not touch, on a change that is fine.** It happens
whenever something else heavy is running — another session's suite, a `dotnet build` — and the
whole cost lands on whoever is committing: the run is thrown away, and the expensive part is
re-deriving from scratch that it is not a regression. It has done this at least twice (34-C,
49-B) and was only written up the second time. CI never sees it, because CI runs the frontend
job alone.

## The row was wrong on all three counts, and the corrected diagnosis is more useful

TI-61 said the failing assertion was `findByTestId('note-title-input')` after
`window.history.forward()`, missing its 1000 ms budget because *the render* was slow.
Measured, none of that holds:

| The row said | Actually |
| --- | --- |
| `Forward reopens the note` | Both reproductions failed in **`Back returns to the home screen`** |
| `findByTestId('note-title-input')`, 1000 ms | `Test timed out in 5000ms` — vitest's **per-test** timeout, a different budget |
| the render misses the window | The render is fine. `<h1>{heading}</h1>` has no data gate, and one pass of the role query costs **15 ms** under load |
| "second observation of the same failure" (34-C) | **Unverified.** The 34-C token-log entry it cites names no test at all — it says only "the one flake (Routing.test)". The claim was an inference presented as an observation |

The row's own arithmetic was the tell. In the first reproduction the steps *before* the failing
assertion ran **2.65x** their unloaded time, while the assertion that unloaded costs 41 ms blew
a 1000 ms budget — a **>9x anomaly against the ambient slowdown**. A uniformly slower box
cannot produce that, so "the render is slow" was never sufficient.

## One cause, which explains why every session blamed a different test

Under contention each step inflates 10-56x, far above the CPU ratio, and the test's *total*
crosses vitest's 5000 ms per-test ceiling. Summing a probe under load: ~3.4 s of measured work
plus render. **Every test in this file sits within about a second of that ceiling.** So the one
that fails is whichever is unluckiest that day — not a property of any single test. That
reconciles the two different error messages as well: at light load the 1000 ms assertion budget
goes first and you get `Unable to find role="heading" and name "Home"`; at heavy load the
5000 ms test budget goes first and you get `Test timed out in 5000ms`. Two symptoms, one cause.

The dominant term is the one nobody suspected:

    backPath=1735ms      # waitFor(() => expect(window.location.pathname).toBe(...))

Unloaded that step is **31 ms**. That is **56x**, against a 2.65x ambient.

## The general pattern — this is the part worth reusing

**`waitFor` on a non-DOM value can only poll. `findBy*` wakes on the change.**

RTL's `waitFor` retries on two triggers: a `MutationObserver` on the container, and a 50 ms
interval. `window.location.pathname` is not in the DOM, so **the MutationObserver cannot see it
change** — the poll is the only trigger left. On a starved event loop the interval fires late
and repeatedly, and the wait costs many multiples of the transition it is waiting for. Every
DOM wait in the same file wakes on the mutation instead, which is why they inflate ~10x while
this one inflates ~56x.

The replacement keeps both assertions and only changes which one waits:

```diff
- await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
- expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
+ await screen.findByTestId('home-view')
+ expect(window.location.pathname).toBe('/w/__default__')
+ expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
```

Sound because React Router renders the destination *because* the location already changed — the
DOM signal cannot precede the URL. And the reordering **verifies its own premise**: that
synchronous pathname assertion *is* the safety check, run on every transition of every copy
(~60 times per run in the experiment), failing loudly in the arm that matters rather than in a
probe standing outside it.

**Scope beyond this file:** 48 of these poll-driven pathname waits across 9 test files.
`OpenNoteTabs.test.tsx` has 23 — four times this file's exposure. In a routing suite the
pathname assertion is the subject, not incidental, so it appears once per user action; a new
routing spec can easily carry a dozen independent chances to cross the ceiling, and passes today
only because the box is quiet. A suite-wide rollout is being filed separately, deliberately
after this result so the pattern rolled out is the one that was proven.

**The natural experiment, which nobody set up:** this file's **first** test,
`opening a note pushes a /notes/:id URL`, already does DOM-signal-then-synchronous-pathname —
and has never been reported flaking. The five that poll have all been blamed at one time or
another. The fix makes the other five consistent with the one that was already right.

## Two things that did not work, recorded because they cost real time

**1. A hypothesis of mine, refuted by its own probe.** I suspected the cost was in the role
query — `computeAccessibleName` plus a `getComputedStyle` ancestor walk per candidate, on every
poll. I had the fix written before measuring. The measurement:

    passTestId=1ms  passScopedRole=120ms  passGlobalRole=15ms   domSize=139

15 ms, against the 1000 ms budget I accused it of eating — and **cheaper than the scoped
`within(...)` replacement I had written** (120 ms). The fix was aimed at nothing. The DOM is 139
elements; I had assumed something far larger. Hence the role query below is kept in its original
global form.

**2. A favourable A/B result, declined as underpowered.** That run gave 2 of 10 as-is copies
failing and 0 of 10 fixed. It looks like a win. Against a ~20% per-copy rate, 0/10 is entirely
consistent with **no effect at all** (Fisher's exact ~0.24). Banking it would have shipped the
refuted hypothesis on a number that could not distinguish it from nothing. The deciding run
therefore pre-registered its thresholds in `DECISION-RULE.md` **before** the numbers existed,
and decides on **durations** — continuous, large expected effect — with pass counts reported but
explicitly not deciding.

## Verification

Everything below is under deliberate contention, because an unloaded green proves nothing here.
Load is reported as process counts first; load average lags ~90 s and has been measured at
ratio 0.28 with three live suites, so it is corroboration only.

<!-- FILL: red / green / injected-defect / isolation, with load figures -->

## Notes

- The suite counter used throughout is `boxcount.sh`, a `/proc` positional walk — `ps | grep`
  counts one suite as ~3 rows and matches wrapper shells. It was positive-controlled by
  confirming it names this worktree while this run was live.
- Contention windows were announced and marked so parallel sessions could hold their commit
  gates; the marker carries a UTC `set_at` and is cleared by an `EXIT`/`INT`/`TERM`/`HUP` trap.
