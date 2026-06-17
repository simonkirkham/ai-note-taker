# The diagnostic that hung the gate for 44 minutes — and the BUG-31 stacked causes underneath

**Date:** 2026-06-17 · **Items:** TI-42, TI-43 (done), TI-44 (open), BUG-31 · **PRs:** #291–#298 · **Deploys:** #592–#600

## One-line lesson

A diagnostic added to *observe* a flaky test made it **worse** — it converted a clean 33 s failure into a 44-minute suite hang — because it read HTTP response bodies in a fire-and-forget handler on a reload loop. Instrument E2E with **synchronous request properties only**, and surface evidence through the **thrown exception message**, never `Console`.

## What happened (in order)

1. **Goal:** prove 10 consecutive green deploys to show the gate isn't flaky. The one known blocker was TI-42 (cards-list flake ~1/10).
2. **PR #291** added `E2EApiTrace`: a `page.Response` listener that read each `/notes/cards` body via `response.TextAsync()` in a fire-and-forget task, to print the workspace prefix.
3. **Deploy #592 attempt 4 hung for 44 minutes** in the E2E step and had to be cancelled by hand. Attempts 1–3 (~8 min each) had passed.
4. Root cause: on the TI-42 reload loop, every `page.ReloadAsync()` **aborts in-flight requests**; `TextAsync()` on an aborted response **never resolves**, and the unawaited hung tasks blocked context teardown.
5. **Compounding:** the diagnostic captured *nothing* anyway — xUnit **swallows `Console.WriteLine` on passing tests**, and a hung test never flushes. The passing-attempt logs had zero `[api-trace]` *and* zero pre-existing `[browser ...]` lines.
6. **PR #292** replaced it with a hang-proof version (sync `.Url` recording + a descriptive `throw`), **PR #293** added a hard **120 s per-test cap** (TI-43) so this class of failure can never recur.
7. With the gate safe, the **10× green streak passed (#595)** and TI-42 did not recur in 13+ runs.

## Durable principles

- **Never read a response/request *body* in an E2E listener.** `IResponse.TextAsync()` / `IRequest.PostDataBuffer` await the body, which a navigation/reload can abort → an indefinite hang. Record only **synchronous** properties: `response.Url`, `response.Status`, `request.Method`, `request.PostData`. (Request `PostData` is sync and was enough to read what keys a `/images/resolve` call carried.)
- **xUnit swallows `Console.WriteLine` on passing tests and never flushes a hung one.** Route E2E diagnostics through the **thrown exception message** — it appears in `dotnet test --log-failed`. The pattern: on a reload-loop deadline, `catch (PlaywrightException)` and `throw new Exception($"…page.Url + rendered state + recorded request URLs…")`. (Note: `WaitForResponseAsync` timeouts throw `System.TimeoutException`, *not* `PlaywrightException` — a 30 000 ms `System.TimeoutException` in a stack is a `WaitForResponse`/`ClickAsync` action timeout, not an assertion timeout. This distinction localised two separate BUG-31 failure points.)
- **Give every E2E test a hard per-test timeout.** One stuck Playwright call with no per-test bound stalls the whole gate until a human notices. `E2EFactAttribute : FactAttribute(Timeout=120_000)`. **But verify it fires** — xUnit's `Timeout` is silently ignored when parallelization is disabled; confirm with a throwaway probe (`[Fact(Timeout=200)]` vs a 5 s delay).
- **"Not reproduced" ≠ "fixed".** TI-42 didn't recur in 13+ runs, but with no failing run there's no proof the workspace hypothesis was the cause — keep it Open with the diagnostic armed.
- **A diagnostic can change the system it observes.** Before merging instrumentation to the shared gate, ask what it does on the *failure* path (reloads, aborts, teardown), not just the happy path.

## BUG-31 — three stacked causes (the TI-39 pattern again)

Un-quarantining under the 120 s cap turned a "needs test-env trace" mystery into a clean, debuggable sequence:

| Layer | Cause | Fix |
|---|---|---|
| 1 | Removed image *reappears* after reopen (the original symptom) | ✅ Already fixed by the RYW systemic changes (TI-39 projector warm-up/drain + BUG-30 auth-from-event-stream); attempts 1–2 passed the image-absent assert |
| 2 | `SaveAndReturnAsync` awaited `GET /notes/cards`, which React Query serves **from cache → no request → 30 s timeout** | ✅ PR #297 — wait on the home navigation (`new-note-button`) instead. Suite-wide win: the just-saved card is added **optimistically**, so all 14 callers still see it |
| 3 | Post-removal `ClickAsync("save-button")` times out 30 s — button is `disabled={loadingDetail}` and `useNoteDetail` stays `isLoading` ~30 s after reopen+edit | 🔲 Open — **TI-44**. A stuck/slow gated note-detail read; needs the thrown-message diagnostic on the detail read. Re-quarantined (PR #298) to keep the gate green |

**Lesson:** a chronically flaky test is often several bugs wearing one costume (TI-39 was four). Peel them one failure at a time with per-attempt evidence; fix the shared-helper ones (layer 2) because they de-flake the *whole* suite, not just the one test. Don't hold the gate red chasing the last layer — re-quarantine with the finding documented and spin it out (TI-44).

## Process note

Re-quarantine ↔ un-quarantine flipped three times here (protect gate → get evidence → protect gate). That's acceptable when each flip is cheap and documented, but the cleaner sequence is: un-quarantine **once** under a safe diagnostic + hard cap, collect *all* per-attempt evidence from that single red window, then either fix or re-quarantine with the full finding — rather than re-deploying per hypothesis.
