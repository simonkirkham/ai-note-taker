# The retry that made the failure slower to see and harder to name

**TI-84** · PR [#474](https://github.com/simonkirkham/ai-note-taker/pull/474) · squash `608c882e` · no deploy (docs + scripts only)

A network blip while a build downloaded a linting tool put a red X on a `main` commit that was fine. A red X that means nothing is worse than no signal at all — this repo already has a case where 162 of them were ignored and the real failure hid among them ([TI-69]).

The fix was one line of `curl` flags. What is worth keeping is that **the first version of it made the symptom worse**, and that review caught it by measuring rather than by reasoning. The fix itself, its four-step proof and the rejected `actions/cache` half are in [TI-84 in the archive](../technical-improvements-archive.md#ti-84-a-momentary-github-outage-paints-a-red-x-on-a-main-commit-that-did-nothing-wrong).

## 1. `--retry-delay` is a floor, not a ceiling

curl sleeps for the **larger** of `--retry-delay` and the server's `Retry-After` header. So a retry delay is a lower bound on the wait and says nothing about the upper one — the remote end chooses.

That is not an exotic path here. GitHub rate-limits release-asset downloads by IP, and Actions runners share IP pools, so `429` with `Retry-After` is what a busy runner actually meets.

Measured against the exact shipped flags (curl 8.5.0, local server):

| Server response | Claimed by the code comment | Measured |
| --- | --- | --- |
| 3 × `429`, `Retry-After: 120` | ~6s | **360.3s**, exit 0 |

At 360s the job's `timeout-minutes: 5` fires first and GitHub kills it with "has exceeded the maximum execution time" — an annotation naming **neither the tool nor the download**.

So on that path the retry replaced a 6-second labelled failure with a 6-minute unattributable one. **Slower to appear and harder to attribute** — a fresh instance of the exact defect the change was closing.

## 2. The reusable rule

> **A timeout you compute from your own flags is a hypothesis. Only a flag that refuses makes it a bound.**

The original comment asserted `4 × 45s + 3 × 2s = 186s`, fits inside `timeout-minutes: 5`. The arithmetic was right and the conclusion was wrong, because nothing enforced the sum. `--retry-max-time` does enforce it; the addition sum did not.

Same family as the standing lesson in [a mechanism nobody has watched work is not working](a-mechanism-nobody-has-watched-work-is-not-working.md): a value that looks like a measurement, is not one, and is never challenged because it agrees with expectation.

## 3. The fix's own first stated bound was also wrong

`--retry-max-time 120` was described as a 120-second ceiling. It is not. It bounds when the last attempt may **begin**, not when it ends — so with `Retry-After: 119` followed by a stall, curl started a retry at ~120s and the per-attempt `--max-time 45` killed it at **164.1s** (exit 28).

True ceiling ~165s, not 120s. Against a 300s job budget that is ~135s of headroom, which is fine — but the number in the comment was wrong until it was measured, on the second pass, after the first pass had already been corrected once.

## 4. Right number, wrong reason — which is its own defect

The corrected comment said curl "refuses to start a retry once that many seconds have elapsed". Under that rule, a `429` at t≈0 carrying `Retry-After: 310` would be retried, and curl would sleep all 310s — past the job kill.

Measured: **refused in 0.011s after one request.** The real rule is that curl starts a retry only if *elapsed plus the sleep it is about to take* fits inside the window, and refuses a `Retry-After` that does not fit outright rather than shortening it. The boundary is inclusive — `Retry-After: 120` exactly is still retried once.

The number in the comment was correct throughout. The mechanism under it was not, and a wrong mechanism in a comment is an invitation for the next person to redo the arithmetic from the wrong rule and reach a different wrong number.

## 5. The control is what made it a measurement

The 40-second reading against `Retry-After: 20` is only interpretable next to its control: the **same server, same flags, no `Retry-After` header** returned **4.0s, exit 0** — as predicted.

Without that arm, 40s is an unattributable number: it could have been the harness, the local server, the shim rewriting the release URL, or the header. With it, the header is the only thing that changed and the only thing that can explain the difference.

Positive control first, then the reading. This is the countermeasure the catalogue already prescribes, applied to a timing measurement rather than to a probe.

## 6. What did not regress, and why that was checked

Retries can launder bad bytes if the integrity check sits inside the retry loop. It does not here: the checksum is outside, and it fires on the first bad response.

Confirmed rather than assumed — a **successful** retry onto 200 KB of `/dev/urandom` still aborted with `checksum mismatch`. And a genuine 404 (a mistyped version) still fails in ~6s with a message naming the download, so the change did not cost the one thing that made the old failure readable.
