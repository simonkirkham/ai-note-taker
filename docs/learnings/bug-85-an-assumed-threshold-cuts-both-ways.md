# BUG-85 loudness slice — an assumed threshold cuts both ways, and the advice must survive both

PR #487 · deploy #783 · merged `ff00b685` · three review rounds, two of them returning must-fixes.

## What the user gets

When the live transcript stops part-way through a meeting, the notice now says whether anyone was actually speaking — so a quiet room and a transcription failure stop looking identical. The record saved to the server carries the loudest sample and how many seconds of speech-level audio arrived since the last words.

## The finding that cost two review rounds

The slice classifies a stall as *quiet room* or *transcription failure* on one number: seconds of audio above −40 dBFS. **That threshold is assumed, not measured** — the slice says so in the code, the PR and the runbook, which is the right thing to do. What it did not do is follow the assumption into the copy.

Three successive versions of the advice:

| Version | `noWords` (claims a fault) | `quiet` (claims no fault) | What it costs the user |
|---|---|---|---|
| Before the slice | *"If the meeting is not simply quiet, stop and start recording again"* | — (the case did not exist) | The quiet room was called a fault |
| As first written | *"Stop and start recording again."* — flat | *"Nothing needs doing if the meeting is quiet."* — no remedy | Threshold reads high → a working recording gets split in two |
| After round 2 | Hedged: *"If people are speaking and nothing is appearing…"* | still no remedy | Threshold reads low → a real stall is told "nothing needs doing", and the meeting is lost |
| After round 3 | Hedged | Hedged: *"If people are speaking, check the microphone, then stop and start recording again."* | Both directions reach the remedy; the genuinely quiet room is still told to relax |

**The generalisable rule.** A classifier built on an unmeasured threshold has *two* error directions, and they land on *different branches*. Round 2 correctly argued that the threshold's uncertainty means the fault branch must hedge — and then left the opposite branch asserting the opposite certainty. Reviewing one branch in isolation cannot see this; the four cases had to be read as a set, with each asked "what does this tell someone the classifier got wrong?"

The asymmetry also matters: a wrongly-advised restart costs a seam in a transcript, a missed stall costs the rest of the meeting. When the two errors cost different amounts, hedge hardest on the expensive side — but reaching the remedy is cheap enough that both branches can have it.

## Two rules that had no test, and passed every spec

Both were found by injecting the defect, not by reading:

1. **Seconds of speech were divided by the capture rate — with nothing pinning it.** Replacing `this.sampleRate` with a literal `16000` passed **all 72 specs**, because every spec ran at 16 000. The browser is explicitly not required to honour the requested rate (the hook records the real one for that reason), and at 48 kHz the defect reports **3× the speech** — turning every quiet room into "transcription stalled", the exact reading the slice exists to get right, inverted.
2. **The documented 10-second boundary had no spec on it.** The runbook states the rule as "10 s or more = stalled, under 10 s = a quiet room". Flipping `<` to `<=` passed all 72; the nearest spec stepped 5 → 15 seconds, straight past the boundary. The constant was exported and imported by nothing, including its own tests.

**The pattern in both:** a value the code reads from a variable, which every test supplies at one fixed value, is not tested — it is *assumed* in exactly the way a hardcoded constant would be. Same for a documented numeric rule whose specs straddle the boundary without landing on it. Grep for the constant: if nothing imports it, nothing pins it.

## What no gate could have caught

Every one of these passed build, lint, both typechecks, 1,337 frontend specs, 39 server specs and seven CI checks. They are not gaps in the suite's density — the suite is dense — they are gaps in *what it varies*. Density within a phase does not test the phase boundary; density at one sample rate does not test the rate.

## The process cost, separately

The change was finished, pushed and green on 2026-09-18 and **sat for three days with no review**, because the session that opened the PR ended without starting one and nothing anywhere surfaces "an open PR with all checks green and no review". The human found it by asking what was left to resume. Filed as [TI-103](../technical-improvements.md#ti-103).
