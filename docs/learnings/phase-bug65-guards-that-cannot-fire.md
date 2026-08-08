# BUG-65 — three guards that could not fire, in the slice that was fixing a guard that could not fire

**Slice:** BUG-65 (#435, deploy #737, installer `1.0.0-20260808.182`). Follows [BUG-56](phase-bug56-the-live-path-that-never-ran.md).

**What shipped:** `--audio-ctx 768` and a 4-8 s sliding window on the live on-device engine, a send-time clamp, and a `<userData>/local-transcription.log` so an installed build can be measured at all.

## The headline lesson

Across BUG-56 and BUG-65 — one bug and its follow-up — **six** defects shared one shape: *a mechanism that reads as a live safety net and cannot fire.* Three of them were introduced **by the fix for the previous one**.

| # | Guard | Why it could never fire |
|---|---|---|
| 1 | The live engine itself (BUG-56) | spawned as `whisper-cli`, which exits on `--host` |
| 2 | The on-device error banner (BUG-56) | rendered only when `status === "error"`, which the on-device handler never sets |
| 3 | The 75 s ready deadline (BUG-56 fix) | `start()` kills the child at 60 s, so `running` was always false by 75 s |
| 4 | A start failure after a short recording (BUG-56 fix) | sent to a renderer that had already detached its listener |
| 5 | `--no-fallback` (BUG-65 fix) | parsed by `server.cpp` and **never read** — dead upstream since v1.6.0 |
| 6 | The runaway guard vs the new clamp (BUG-65 fix) | `windowMs` pinned at the send cap could never reach `hardWindowMs` if that rose above it |

**None were caught by tests. All were caught by review.** Worse, in two cases a *passing test asserted the dead mechanism as working* — the `--no-fallback` assertion, and an "invariant" test that compared two constants which did not bound the runtime value at all.

### What to do about it

1. **Budget more review rounds for this bug class.** "A path nobody verified" invites a patch that adds another one. BUG-56 took three rounds, BUG-65 took two; every round found something real.
2. **A test that asserts a mechanism is *configured* is not evidence it *works*.** `expect(args).toContain('--no-fallback')` passed happily against a flag the server ignores. Prefer asserting the observable effect; where that is impossible (as here), assert the *absence* of the thing you deliberately did not do, and say why in the test.
3. **Verify a guard is non-vacuous by breaking it.** Inverting `READY_TIMEOUT_MS` above the start timeout made its test fail — that check is what turned "I think this is locked" into "this is locked". Do it once per guard.
4. **Two constants in different modules that must be ordered are an invariant, and comments do not hold it.** Three of the six were ordering failures. Export both and assert the relationship; derive one from the other where possible so the ordering cannot silently invert.

## Non-obvious technical lessons

### Parsing a flag is not the same as the flag taking effect

Learning from BUG-56 that an unknown argument kills `whisper-server` (it calls `exit(0)`, so a typo looks like a *clean shutdown*), every new flag was checked against the pinned parser. That check passed — and was still insufficient. `server.cpp` parses `--no-fallback` at one line and never reads it again; `cli.cpp` and `stream.cpp` both carry the `no_fallback ? 0.0f : …` mapping the server omits. The symbol table showed the flag present, which is what "verified from its symbol table" in the first draft actually meant: **a symbol table proves a flag exists, never that it is consulted.**

### whisper always encodes a padded 30-second mel

This invalidates the assumption behind [BUG-53]'s design ("re-inference on a short sliding window is fast, ~1.4 s for a 3 s window"). A 3 s window costs nearly what 30 s does unless `audio_ctx` is lowered. Compounding it, `maxWindowMs` is the window's **floor, not its cap** — nothing commits until the window *exceeds* it — so 8000 meant a steady-state window of 8-16 s, not ~3 s.

### `audio_ctx` overshoot skips audio, it does not merely degrade it

Past the context, whisper truncates the mel copy — but the seek loop still advances a full 30 s on a missed timestamp. So a window larger than the encoder context loses ~15 s of audio entirely. And `hardWindowMs` did **not** bound the runtime window: `finalizedMs` advances only after an inference completes while the busy-guard drops ticks, so the real window is roughly `inferenceMs + stabilityMs + STEP_MS` and exceeds the context on exactly the slow machine that has the bug. Hence a clamp at send time, not a constant comparison.

### 768 is the right reduction for a reason unrelated to speed

`GGML_PAD(n_ctx, 256)` makes 768 exactly 3×256 → **zero unmasked pad rows**, versus 36 at the 1500 default. That matters while the upstream pad-row attention bug (whisper.cpp PR #3941) is open. The justification originally written here — "whisper.cpp's `stream` example uses 768" — was **false**; `stream.cpp` defaults `audio_ctx` to 0. The 768 figure comes from the `command` example, a short-utterance workload, and `whisper.h` labels the option EXPERIMENTAL and quality-reducing.

### A speed fix and a quality guard can be coupled

The obvious repair for the dead `--no-fallback` is a per-request `temperature_inc: 0`. It was deliberately **not** taken: collapsing the temperature ladder also disables whisper's repetition guard, and a reduced `audio_ctx` is documented to *induce* repetition loops. The fix for cause 2 would have amplified a risk created by the fix for cause 1. Left in place pending measurement.

## Process notes

- **Editing a shared standing register from a branch is a documentation hazard, and the tooling already knows it.** Four slips in two days: [TI-53] was re-filed as TI-58 because the register was not read first; a mechanical substitution garbled a sentence a parallel session had rewritten; an auto-merge silently produced **duplicate BUG-64 and BUG-65 rows** with contradictory statuses (`phase-bugs.md` rows are single very long lines, so `ort` treats a divergent row as an added line and merges both **without a conflict**); and Scribe then tried to file a technical-improvement for that gap — which **already does not exist**. `check-doc-ids.sh` detects duplicate rows within a table and its error message names the merge union driver explicitly; it is also what turned the PR red. The correct response to all four is the same and it is not more tooling: **read the register before writing to it.** Mitigation for the merge case: pick survivors by `diff`-ing candidates against `origin/main`, never by reading them — the stale row was the plausible-looking one.
- **`gh pr checks` reporting a single green line is not green.** On a `CONFLICTING` branch the merge-result checks never start, so the list is near-empty and reads as passing. Confirm `mergeable`/`mergeStateStatus` **and** that the expected jobs are present. Hit once here; `merge-gate.sh` catches it, a bare `gh pr checks` does not.
- **The user's manual test cycle is the real cost constraint.** Each iteration costs them a build → install → record → report loop, which is why instrumentation and tuning shipped together rather than instrument-first. That trade should be made explicitly whenever a human is in the verification loop.
- **Still unmeasured.** Nothing here is confirmed on hardware. `MANUAL-VERIFICATION.md` §BUG-65 defines the evidence: `rtf` < 1.0 means the engine keeps pace. Threads were deliberately left alone (raising them re-opens [BUG-52]'s CPU peg) and are the next lever *if the data says so*.
