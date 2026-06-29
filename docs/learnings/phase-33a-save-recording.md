# Phase 33-A — Save the call recording

**Slice:** tee the live 16 kHz mono PCM into a WAV, upload to a new `notetaker-recordings` S3 bucket on Stop, expose a "Download recording" link. PR #324, deploy #624 (2026-06-23).

## The one non-obvious thing: a new projection *field* is not a new projection — no backfill

The guardrail "a new read projection ships empty — trigger a backfill" is about a new projection **table**. 33-A added a new **field** (`RecordingAudioKey`) to the *existing* `NoteDetail` projection, populated only by a brand-new event type (`RecordingUploaded`). There is **no history to fold** — no note written before this deploy ever emitted `RecordingUploaded`, so every pre-existing row correctly has a null key, and a rebuild would change nothing. So: **skip the backfill when the new field is fed solely by a new event type.** (Contrast: a new field derived from an *existing* event — e.g. re-deriving something from `NoteCreated` — *would* need a rebuild to populate historical rows.)

## Reusable patterns confirmed

| Concern | What worked |
|---|---|
| Capture audio without a second pipeline | Tee the **same** PCM chunks the streaming path already emits (`PcmChunker` → both the Transcribe queue and a recording buffer). `PcmChunker` returns freshly-allocated buffers, so teeing one chunk to two consumers is alias-safe — no copy needed. |
| WAV header correctness | Use `audioContext.sampleRate` (the **actual** rate, the same value passed to Transcribe's `MediaSampleRateHertz`), not the requested 16 kHz — the browser may not honour the request, and a mismatched header plays back at the wrong speed. |
| Working-artefact S3 bucket | `RemovalPolicy.DESTROY` + `AutoDeleteObjects` + a 7-day `Expiration` lifecycle rule (vs the images bucket's `RETAIN`). The 7-day expiry is also the unique discriminator for infra assertions (web bucket = 30 days, images = none). |
| Ownership on a presign/save flow | Save authorizes from the **event stream** (Command Lambda) — the presign endpoints authorize via the projection, mirroring the accepted image-upload pattern (the note exists long before recording, so the projection is warm). |

## Pipeline note

Layer-split (backend pass → frontend pass) kept each implementation pass small. Hawk approved round one with two should-fixes — both were *docs/test completeness* (event-model/schemas entries, an IAM-grant infra assertion), not code defects; pre-empting those in the Refactor pre-PR checklist (every new event → event-model + event-schemas; every new IAM grant → a scoped-resource assertion, not just an action assertion) would have saved the round.
