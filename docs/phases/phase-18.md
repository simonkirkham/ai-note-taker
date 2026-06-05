# Phase 18 — Crash-safe transcription: draft autosave & recovery

**Goal:** A live transcript must survive an interrupted recording. Today the transcript is persisted **only at terminal points** (Stop / natural stream end), so a crash, tab close, or navigation mid-call loses everything captured so far. A shipped stopgap (parked on branch `wip/phase-18-transcription-crash-resilience`) added an unmount flush plus a 15s autosave — but that autosave re-POSTs `TranscriptionCompleted` every ~15s, bloating a **snapshot-less** event log that replays the full stream on every command ([ADR 0011](../adr/0011-transcription-checkpoints-draft-store.md)). This phase implements the correct design: interim checkpoints go to an **overwrite-in-place draft store** (not the event log); the log records exactly **one `TranscriptionCompleted` per recording** on a clean stop; and an interrupted recording is **recoverable** via a Recover / Discard banner when the note is reopened. The headline lesson: not every durable write is an event — some state is loss-tolerant working state that belongs beside the log, not in it.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 18-A | **Durable checkpoints without polluting the event log.** A new DynamoDB draft store (one overwritten item per note, TTL self-clean); `PUT`/`DELETE /notes/{id}/transcription/draft` (no events); `POST /notes/{id}/transcription` also deletes the draft; `GET /notes/{id}` exposes an uncommitted draft. Documents `TranscriptionCompleted` in the event model (pre-existing gap) and the draft store as a non-event store. | Done | — |
| 18-B | **Autosave to the draft, recover on reopen.** The checkpoint timer `PUT`s the draft instead of POSTing the event; clean Stop / intentional leave still commit (POST → event + draft delete); a **Recover / Discard banner** appears when a reopened note has an uncommitted draft. Folds in the stopgap's leave-warning + recording-counts-as-content fixes. | Done | 18-A |
| 18-C | **Continue a transcript — record again and append.** Pressing Record on a note that already has a committed transcript prompts **Continue** (append the new session after a `— resumed —` separator) or **Re-record** (replace, today's behaviour). Frontend-only: a resumed session seeds from the committed transcript and the commit saves the concatenation via the existing `TranscriptionCompleted` (latest-wins) — no new event/endpoint/CDK; the 18-A/18-B draft store autosaves & recovers the concatenation unchanged. | Done | 18-A, 18-B |

> **Slice order.** 18-A ships the backend draft path and the recovery *contract* (`GET` exposes `transcriptDraft`); it stands alone and is testable end to end via the API without any UI. 18-B retargets the frontend autosave from the event to the draft and adds the recovery UX, so it depends on 18-A's endpoints and `GET` shape. 18-B should **build on / cherry-pick** the stopgap branch `wip/phase-18-transcription-crash-resilience` (commit `789dd9b`) — the unmount-flush, `beforeunload` guard, leave-confirm, and recording-counts-as-content changes are reused unchanged; only the checkpoint *target* changes (PUT draft, not POST event).

**Confirmed product decisions (from Scout brief, 2026-06-05):**
- **Recovery UX:** on reopening a note left by an *interrupted* recording, show a **Recover / Discard banner** above the tabs (Option 1). `Recover` commits the draft → `TranscriptionCompleted`; `Discard` deletes the draft. No write happens just from opening a note.
- **Checkpoint target:** an overwrite-in-place **draft store**, not a new event and not a repeated `TranscriptionCompleted`. Per [ADR 0011](../adr/0011-transcription-checkpoints-draft-store.md).
- **What leaves a draft:** only *unexpected* loss (crash, tab close, power loss). A clean Stop or pressing back **commits** (one `TranscriptionCompleted`) and deletes the draft, so the happy path never shows a recovery banner.
- **Replace semantics on recover:** `Recover` sets the note's transcript to the recovered text (consistent with the existing "latest recording replaces" behaviour of `TranscriptionCompleted`).
- **Checkpoint cadence:** 15s (unchanged from the stopgap; now safe to tune since drafts don't touch the log).
- **Draft lifetime:** a TTL (48h) auto-reaps abandoned drafts so they don't accumulate.

**Learning surface:** a deliberately **non-event-sourced, loss-tolerant working-state store** living beside the event log (the "not everything is an event" lesson, motivated by the snapshot-less full-stream-replay cost in [ADR 0011](../adr/0011-transcription-checkpoints-draft-store.md)); an **idempotent overwrite (`PUT`) endpoint** contrasted with the event-emitting `POST`; **composing a read-time view** (`GET /notes/{id}` = projection + draft) without polluting a rebuildable projection; **DynamoDB TTL** for self-cleaning ephemeral data; and a **recovery UX** for interrupted sessions.

---

## Slice 18-A — Durable checkpoints without polluting the event log

**Status:** Done

**User value:** (enabler) The transcript captured so far is durably saved every few seconds during a recording, without adding noise to the event stream, and a reopened note can tell whether an earlier recording was interrupted. No visible UI change in this slice — it delivers the backend draft path and the recovery contract that 18-B consumes.

### How it works (implementation notes)

- **Draft store (`src/EventStore/`, beside the projections).** New `ITranscriptionDraftStore`:
  - `SaveAsync(TranscriptionDraft draft, ct)` — overwrite the single item for the note. `TranscriptionDraft` carries `NoteId`, `UserId`, `Text`, `DurationSeconds`, `CapturedAt`.
  - `GetAsync(NoteId, ct)` → `TranscriptionDraft?` or null.
  - `DeleteAsync(NoteId, ct)` — delete-if-exists (idempotent).
  - `DynamoDbTranscriptionDraftStore` — one item per note (PK = the note's stream id), with the owning `UserId` stored as an attribute. A note has exactly one owner and every endpoint enforces ownership at the handler boundary before touching the store, so the key is the note id, not a composite. Written with `PutItem` (full overwrite), carrying a `TTL` epoch attribute = `CapturedAt + 48h`. An in-memory implementation backs `Api.Integration`.
- **New DynamoDB table (`src/Infrastructure`).** `notetaker-draft-transcription` (PK = `PK`, the note's stream id), **TTL enabled** on the `TTL` attribute, `RemovalPolicy.DESTROY` (working state, not durable record). Least-privilege grant to the API Lambda (`Get/Put/DeleteItem` only). `Infrastructure.Assertions` covers table existence, TTL spec, deletion policy, and the scoped IAM grant.
- **Endpoints (`TranscriptionEndpoints` / `TranscriptionHandlers`).**
  - `PUT /notes/{noteId:guid}/transcription/draft` → `SaveDraft`: ownership check via `noteDetailStore` (404 if missing / not owner), reject blank text (`422`), `SaveAsync`, return `204`. **No event.**
  - `DELETE /notes/{noteId:guid}/transcription/draft` → `DiscardDraft`: ownership check, `DeleteAsync`, `204`. **No event.**
  - `POST /notes/{noteId:guid}/transcription` (`CompleteTranscription`) — **unchanged contract**; after the command succeeds, call `DeleteAsync` (best-effort) so a clean completion clears any draft.
- **`GET /notes/{noteId}` exposes the uncommitted draft.** `NoteHandlers.GetNote` additionally reads the draft store and composes `transcriptDraft` onto the response **at read time** (not stored in `NoteDetailView` — it is working state, not a projection field). Surface the draft only when it is *uncommitted*: present **and** not equal to / a prefix of the committed `transcriptText` (guards the stale-draft-after-failed-delete case). Shape: `transcriptDraft: { text: string, capturedAt: string } | null`.
- **Event model documentation.** `docs/event-model.md` is missing `CompleteTranscription` / `TranscriptionCompleted` entirely (pre-existing gap). Add the command row, the event, and a short note that transcription **checkpoints** are draft state (link ADR 0011), explicitly *not* an event. No new event is introduced by this phase.

### Scenarios

```
Scenario: A draft checkpoint is saved without emitting an event
  Given a note owned by the caller
  When  PUT /notes/{id}/transcription/draft is called with transcript text
  Then  it returns 204
  And   no new event is appended to the note's stream
  And   GET /notes/{id} returns that text as transcriptDraft

Scenario: A later checkpoint overwrites the earlier draft
  Given a note with an existing draft
  When  PUT .../draft is called again with longer text
  Then  GET /notes/{id} returns only the latest text as transcriptDraft

Scenario: Completing the transcription clears the draft
  Given a note with an uncommitted draft
  When  POST /notes/{id}/transcription is called
  Then  a single TranscriptionCompleted event is appended
  And   GET /notes/{id} returns transcriptDraft = null
  And   the committed transcriptText is the posted text

Scenario: Discarding a draft removes it without an event
  Given a note with an uncommitted draft
  When  DELETE /notes/{id}/transcription/draft is called
  Then  it returns 204
  And   GET /notes/{id} returns transcriptDraft = null
  And   the note's committed transcriptText is unchanged

Scenario: A draft equal to the committed transcript is not offered for recovery
  Given a note whose committed transcript equals a leftover draft (failed delete)
  When  GET /notes/{id} is called
  Then  transcriptDraft is null (treated as already committed)

Scenario: Draft endpoints enforce ownership
  When  PUT/DELETE .../draft is called for a note the caller does not own
  Then  it returns 404

Scenario: A blank draft is rejected
  When  PUT .../draft is called with empty text
  Then  it returns 422
```

### Acceptance criteria

- [x] `ITranscriptionDraftStore` (`Save`/`Get`/`Delete`) with a DynamoDB implementation (single overwritten item per note, keyed by the note id with the owning `UserId` as an attribute, `TTL` = CapturedAt + 48h) and an in-memory implementation for tests
- [ ] `PUT /notes/{id}/transcription/draft` (overwrite, ownership-checked, blank ⇒ 422, **no event**, 204) and `DELETE /notes/{id}/transcription/draft` (idempotent, ownership-checked, **no event**, 204)
- [ ] `POST /notes/{id}/transcription` unchanged in contract; additionally deletes the draft on success
- [ ] `GET /notes/{id}` composes `transcriptDraft { text, capturedAt } | null` at read time; surfaced only when present and not equal-to/prefix-of the committed transcript; `NoteDetailView` projection unchanged
- [ ] CDK `TranscriptionDrafts` table with TTL enabled and `DESTROY` removal policy; API Lambda granted only `Get/Put/DeleteItem`; `Infrastructure.Assertions` covers table, TTL, deletion policy, IAM scope
- [ ] `docs/event-model.md` documents `CompleteTranscription`/`TranscriptionCompleted` and notes checkpoints are draft state (not an event), linking ADR 0011
- [ ] `Domain.Specs` (no new event — draft store unit-tested directly), `EventStore.Integration` (DynamoDB Local: save/overwrite/get/delete/TTL attribute present), `Api.Integration` (all scenarios above) green; `cdk synth` succeeds

---

## Slice 18-B — Autosave to the draft, recover on reopen

**Status:** Done

**User value:** While recording, the transcript is autosaved every 15s to the draft, so a crash, closed tab, or dead battery loses **at most the last ~15s**, not the whole call. Reopening a note that was left mid-recording shows a banner — **"Unsaved transcript from an interrupted recording"** with **Recover** and **Discard** — so the user decides whether to keep it. A clean Stop or pressing back saves the transcript as before and the banner never appears.

### How it works (implementation notes)

Start from the stopgap branch `wip/phase-18-transcription-crash-resilience` (`789dd9b`); reuse its unmount-flush, `beforeunload` guard, leave-confirm, and recording-counts-as-content changes unchanged. The only mechanism change is the checkpoint target.

- **`web/src/api.ts`.** Add `saveTranscriptionDraft(noteId, text, durationSeconds)` (`PUT .../draft`) and `discardTranscriptionDraft(noteId)` (`DELETE .../draft`). Keep `completeTranscription` (`POST`) for the commit path. `getNoteDetail` gains `transcriptDraft`.
- **`useTranscription`.** The 15s checkpoint timer calls `saveTranscriptionDraft` (PUT draft) — **not** `completeTranscription`. Clean **Stop**, natural stream end, and **intentional unmount** (navigation away) still call `completeTranscription` (POST → one `TranscriptionCompleted`, backend deletes the draft). The `beforeunload` guard stays (covers crash/close where neither Stop nor unmount runs). Net: intentional exits commit; only unexpected loss leaves a draft.
- **`NoteView` — recovery banner.** On load, if `getNoteDetail` returns `transcriptDraft`, render a banner above the tabs: text + **Recover** + **Discard**.
  - **Recover:** optimistically hide the banner and show the draft text in the Transcript tab, then `completeTranscription(noteId, draft.text, …)` (commit → event, backend clears draft); reconcile/restore the banner on error.
  - **Discard:** optimistically hide the banner, then `discardTranscriptionDraft(noteId)`; reconcile on error.
  - The committed transcript view underneath is untouched until Recover commits.
- **Retain from the stopgap:** the inline "still recording" leave-confirm on Save, the `beforeunload` guard, and `hasContent` counting an active recording (so a mid-recording new note shows Save, never Cancel/delete).

### Scenarios

```
Scenario: The transcript is autosaved to the draft while recording
  Given I am recording a transcript
  When  a checkpoint interval elapses with new finalised text
  Then  the text is saved via PUT .../draft (no event is created)

Scenario: A clean stop commits once and leaves no draft
  Given I am recording
  When  I press Stop
  Then  the transcript is committed via POST (one TranscriptionCompleted)
  And   reopening the note shows no recovery banner

Scenario: An interrupted recording is recoverable on reopen
  Given a recording was interrupted (tab closed) leaving an uncommitted draft
  When  I reopen the note
  Then  a banner offers Recover and Discard
  And   the Transcript tab still shows the previously committed transcript (if any)

Scenario: Recover commits the draft
  Given the recovery banner is shown
  When  I click Recover
  Then  the banner disappears immediately (optimistic)
  And   the draft is committed (POST → TranscriptionCompleted) and the transcript updates
  And   reopening the note shows no banner

Scenario: Discard drops the draft
  Given the recovery banner is shown
  When  I click Discard
  Then  the banner disappears immediately (optimistic)
  And   the draft is deleted (DELETE .../draft)
  And   any previously committed transcript is unchanged

Scenario: Opening a note never auto-commits
  Given a note with an uncommitted draft
  When  I open the note and take no action
  Then  no TranscriptionCompleted event is created

Scenario: Leaving mid-recording still warns and commits
  Given I am recording on a note
  When  I press Save/back
  Then  I am warned (still recording) and on confirm the transcript is committed and the draft cleared
```

### Acceptance criteria

- [ ] `api.ts`: `saveTranscriptionDraft` (PUT) + `discardTranscriptionDraft` (DELETE); `completeTranscription` retained for commit; `getNoteDetail` exposes `transcriptDraft`
- [ ] `useTranscription`: checkpoint timer PUTs the draft (no event mid-recording); Stop / natural end / intentional unmount commit via POST; `beforeunload` guard retained
- [ ] `NoteView`: recovery banner with **Recover** (optimistic hide → commit) and **Discard** (optimistic hide → delete); reconcile on error; committed transcript untouched until Recover
- [ ] Stopgap behaviours retained: inline "still recording" leave-confirm, recording counts as content (Save not Cancel/delete)
- [ ] Optimistic UI on Recover/Discard per the project convention (explicit BDD acceptance criterion)
- [ ] Component tests: checkpoint PUTs the draft (not POST); Stop commits once; banner shows only when `transcriptDraft` present; Recover commits + hides; Discard deletes + hides; opening never auto-commits; existing RecordControl/NoteView specs updated for the PUT target; kept transcription E2E journey green

---

## Slice 18-C — Continue a transcript: record again and append

**Status:** Done

**User value:** A recording no longer has to be a single take. Pressing **Record** on a note that already has a transcript asks whether to **Continue** (keep recording and append to what's there) or **Re-record** (start over, replacing it — today's behaviour). A continued session shows the prior transcript, a **`— resumed —`** separator, then the new turns, and stopping saves the whole thing. This makes a meeting that ran long, dropped, or was paused recoverable as one continuous transcript.

**Confirmed product decisions (from Scout brief, 2026-06-05):**
- **Trigger:** an **explicit Continue / Re-record prompt** shown only when a committed transcript already exists. No silent default; a note with no transcript records immediately as today.
- **Speaker labels:** **reset per session** (AWS Transcribe numbers speakers from scratch each session, so labels aren't identity-stable across sessions); a `— resumed —` separator marks each session boundary so the reset is honest and visible. No cross-session speaker reconciliation.
- **No new event:** a resumed recording commits the **concatenation** via the existing `TranscriptionCompleted` (latest-wins replace). The event model stays one event per commit.

### How it works (implementation notes)

Frontend-only — no backend, event, or CDK change. Builds on 18-A's draft store and 18-B's autosave/recovery.

- **`useTranscription` — seed-and-append.** `startRecording` gains a resume input (e.g. `startRecording(includeCallAudio, { resumeFrom?: string })`). When `resumeFrom` is present, seed `finalizedRef` with `resumeFrom + "\n— resumed —\n"` *before* streaming, so the session's new finalised turns are appended after it; the live `setTranscript` shows the combined text from the first result. The new session's `SpeakerTranscript` still starts fresh (labels reset by design). `lastDraftRef`/`committedRef` reset as today. Net: the 15s checkpoint draft and the final commit both carry the **full concatenation**, so 18-A's `PUT`-draft and 18-B's `POST`-commit/recovery paths work unchanged.
- **`RecordControl` — Continue / Re-record prompt.** When a committed transcript exists (`hasInitialTranscript`), clicking **Record** shows an inline two-button prompt (mirroring NoteView's leave-confirm idiom): **Continue** → `startRecording(includeCallAudio, { resumeFrom: <committed transcript> })`; **Re-record** → `startRecording(includeCallAudio)` (fresh, replaces). With no committed transcript, Record starts immediately (no prompt) exactly as today.
- **`NoteView` — pass the transcript text.** RecordControl today only receives `hasInitialTranscript` (a boolean) and `noteHasContent`; add the actual committed `transcriptText` so a Continue can seed from it.
- **Event model doc.** Add a one-line note under `TranscriptionCompleted` that a *resumed* recording commits the prior text + new turns as a single replace (still one event per commit; resume is a frontend concatenation, not a new event).
- **Optimistic UI.** A Continue session shows the combined transcript (prior + live new turns) from the first result — the user never sees the prior text disappear.

### Scenarios

```
Scenario: Recording on a note with no transcript starts immediately
  Given a note with no committed transcript
  When  I press Record
  Then  recording starts with no prompt (unchanged)

Scenario: Recording on a note that has a transcript prompts Continue or Re-record
  Given a note with a committed transcript
  When  I press Record
  Then  I am asked to Continue or Re-record
  And   recording has not started yet

Scenario: Continue appends the new session to the existing transcript
  Given the Continue / Re-record prompt is shown
  When  I choose Continue and speak
  Then  the transcript shows the prior text, a "— resumed —" separator, then the new turns
  And   stopping commits the full concatenation as the note's transcript

Scenario: Re-record replaces the existing transcript
  Given the Continue / Re-record prompt is shown
  When  I choose Re-record and speak
  Then  the new session replaces the prior transcript (today's behaviour)

Scenario: Speaker labels reset per resumed session
  Given a continued recording
  Then  the resumed session's speakers are numbered from Speaker 1 again, below the separator

Scenario: A continued recording autosaves and recovers the full concatenation
  Given I am in a continued recording
  When  a checkpoint fires, or the tab crashes and I reopen the note
  Then  the draft / recovered transcript contains the prior text + separator + new turns

Scenario: Leaving mid-continue commits the concatenation
  Given I am in a continued recording
  When  I navigate away (after the leave warning)
  Then  the committed transcript is the prior text + separator + the captured new turns
```

### Acceptance criteria

- [ ] `useTranscription.startRecording` accepts a resume input and seeds `finalizedRef` with `resumeFrom + "— resumed —"` so new turns append; speaker labels reset per session; `lastDraftRef`/`committedRef` reset as today
- [ ] `RecordControl` shows an inline **Continue / Re-record** prompt only when a committed transcript exists; Continue resumes (append), Re-record replaces; no prompt when there is no transcript
- [ ] `NoteView` passes the committed transcript text to `RecordControl`
- [ ] The 15s checkpoint draft and the final commit carry the full concatenation; 18-B recovery surfaces the concatenation; **no new event / endpoint / CDK**
- [ ] `— resumed —` separator rendered at each session boundary
- [ ] Optimistic: the combined transcript (prior + live) is visible from the start of a Continue session (explicit BDD acceptance criterion)
- [ ] Event-model doc note: a resumed recording commits the concatenation as a single `TranscriptionCompleted`
- [ ] Component tests: prompt shown only with an existing transcript; Continue appends + separator; Re-record replaces; speakers reset; commit carries the concatenation; existing RecordControl/NoteView specs updated; `tsc` + `lint` + `vitest` green

> **Single vertical slice.** 18-C is frontend-only and small (hook seed-and-append + the prompt + one prop). The natural Breaker sub-split seam is **hook append-logic (`useTranscription` seed) → prompt UI (`RecordControl`)**, but the value is invisible split either way, so keep it one slice unless the diff grows. Depends on 18-A + 18-B (the draft store and recovery must carry the concatenation, which they do unchanged).

---

## Out of scope (explicitly deferred)

- **Draft bodies larger than the 400 KB DynamoDB item limit.** Expected meeting lengths fit; the S3-backed-body escape hatch is recorded in ADR 0011's *Revisit when*, not built here.
- **Multi-device draft sync / resuming a recording on another device.** A draft is a single-note recovery buffer, not a cross-session live stream.
- **Recovering the in-flight partial sentence at the instant of the crash.** Only finalised speaker turns up to the last checkpoint are saved; the unfinalised tail (≤ ~15s) is gone by design.
- **Merging a recovered draft with an existing committed transcript.** Recover *replaces* (consistent with existing `TranscriptionCompleted` semantics); concatenation is not a goal.
- **A visible "saving…/saved" indicator for each checkpoint.** Considered for 18-B's observability (below) but not a committed deliverable unless checkpoint failures prove common.
- **(18-C) Cross-session speaker identity reconciliation.** Resumed-session speaker labels reset by design; matching "Speaker 1" across sessions to the same person is not a goal.
- **(18-C) Per-session timestamps / headers** beyond the `— resumed —` separator, and auto-continue without the explicit prompt — the trigger is always an explicit Continue / Re-record choice.

> Note: the *recovery* path (18-B) **replaces** with the recovered draft (a single interrupted session). The *resume* path (18-C) deliberately **concatenates** onto the committed transcript. These are different user actions — recovery is not append, and append is not recovery.

---

## Observability

The whole point of this phase is that a checkpoint *did* save — silent failure here defeats it.

1. **Silent checkpoint-save failures (highest risk).** The frontend `PUT .../draft` is best-effort and its errors are swallowed; if every checkpoint is 4xx/5xx (auth lapse, throttling, >400 KB item) the user believes they are protected while nothing is saved, and a crash then loses everything. Guard: **server-side log + an EMF metric** (`TranscriptDraftSaved` / `TranscriptDraftSaveFailed`) on the draft endpoints, and on the frontend a **subtle "not saved" indicator** if N consecutive checkpoint PUTs fail (cheap, surfaces the only failure mode that silently breaks the feature). The full indicator is optional; the server metric/log is not.
2. **>400 KB item write rejection.** A long meeting can exceed the DynamoDB item limit; the `PutItem` then fails every checkpoint. Log the rejected size at warning so it is diagnosable (and is the trigger for the ADR 0011 S3 escape hatch), distinct from a transient throttle.
3. **TTL reaping an active-but-paused session.** A 48h TTL is far longer than any meeting, but log draft `CapturedAt`/`ttl` on save so a too-aggressive TTL (were it ever shortened) is visible rather than silently dropping recoverable drafts.
4. **Recovery never offered when it should be.** If `GET /notes/{id}` fails to compose `transcriptDraft` (e.g. the equal-to-committed guard is too aggressive), the banner silently never appears and the user can't recover. This is logic, not telemetry: guard with the 18-A `Api.Integration` scenarios (draft surfaced when uncommitted; suppressed when equal to committed) and an 18-B component test.
5. **(18-C) Silent transcript loss on resume.** The highest-risk 18-C failure: a **Continue** that fails to seed `finalizedRef` would commit only the new session and **replace** the prior transcript — silent data loss with no error. This is frontend logic, not telemetry: guard with a component test asserting a Continue commit's text *contains* the prior transcript + separator, and (symmetrically) that a Re-record commit's text does *not*.

Fold the draft-endpoint metric/log into 18-A's backend work and the failure indicator + banner assertions into 18-B. The 18-C guard is a component-test assertion, not instrumentation. Run the `observability-brief` skill output into the acceptance criteria when Breaker drafts each spec.
