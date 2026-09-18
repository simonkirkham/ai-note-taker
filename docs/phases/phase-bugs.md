# Phase Bugs — Defect backlog

**Goal:** A standing, unnumbered phase that captures bugs found in the deployed app and tracks them to a fix. Unlike numbered phases, this has no learning theme and no fixed slice sequence — items are added as defects surface and moved to the archive as they are fixed. Each bug is still fixed the normal way: a failing spec/test that reproduces it first, then the fix.

**What belongs here:** defects — behaviour that is wrong, broken, or crashes. If it's a small adjustment to working behaviour it's a **minor change** ([docs/phases/phase-minor-changes.md](phase-minor-changes.md)); a new capability is a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase); a refactor/upgrade/CI item is a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Fixed bugs live in [phase-bugs-archive.md](phase-bugs-archive.md)** — one condensed entry each, anchors preserved. This doc carries only what is still open.

**How this doc is written.** The Summary table is the review surface: one or two lines per bug, in plain language, saying what the person using the app experiences. No file names, no event or projection names, no status codes. Everything else — evidence, diagnosis, fix direction, severity — goes in that bug's section below the divider. When a bug is fixed, condense it into the archive and delete its row and section from here.

---

## Summary

Ordered by severity, then by id.

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| BUG-77 | You finish a recording and the note is never analysed. You are now told what actually stopped it — an unreachable server, a note that has gone, a service that is briefly down — instead of one catch-all sentence, and the failure is recorded so a repeat can be diagnosed. Why it happens at all is still unknown. | Open | TI-67, TI-78, BUG-33 |
| BUG-79 | An action item you add in the first second or two after making a note is silently thrown away for good, and while that happens everything else you do for the next half minute stops updating. | Open | — |
| BUG-81 | Typing a title on a brand-new note and clicking Save can delete the note instead — the button changes from Save to Cancel under your cursor, and Cancel throws a new note away. | Open | — |
| BUG-84 | Asking the app to analyse a longer meeting fails almost every time — 7 of the last 9 tries failed — and the message tells you to try again in a minute, which cannot help. | Open | TI-63 |
| BUG-85 | The live transcript can silently stop part-way through a meeting while the recording timer keeps running. It has now happened twice, costing 54 minutes of one meeting and 3.5 hours of another. You are now told within two minutes, and told which of three things went wrong; stopping it happening at all is still to do. | In Progress | — |
| [BUG-86](#bug-86--on-device-speaker-labels-put-the-other-sides-words-under-me-too) | **On a call played through speakers, the on-device "who said what" labels are wrong: nearly every line the other side says appears twice, once as "Them" and once as "Me", and your own words are buried inside those repeats.** Makes the labelled transcript unreadable for any call not taken on headphones. | Open | — |
| [BUG-87](#bug-87--finalising-transcript-takes-almost-as-long-as-the-meeting) | **After you stop an on-device recording, "Finalising transcript…" runs for almost as long as the meeting itself — 3 m 22 s for a 3 m 46 s test, so roughly 55 minutes after a one-hour meeting — before labels or analysis appear.** | Open | — |
| BUG-70 | Clicking "+ New Note" while recording and then choosing to keep recording still leaves a blank, untitled note behind on your home list. | Open — held behind 51-C | BUG-54, 51-C |
| BUG-73 | Signing out while an on-device transcript is still finishing can park you for up to an hour with no way to leave — a real problem on a shared machine. | Open | BUG-55 |
| BUG-75 | Reopening a note while its on-device transcript is still finishing shows no transcript, and nothing appears until you navigate again or reload. | Open | BUG-72 |
| BUG-78 | A truncated or hand-edited sign-in link drops you at the sign-in screen and claims your browser is blocking storage — and the message comes back on every reload. | Open | BUG-71, BUG-60, BUG-15 |
| BUG-80 | A topic you add from the agenda strip can land in an invisible checklist at the very top of the note — the header lists it, but you cannot find it in the note to edit it in place. | Open | BUG-76 |
| BUG-82 | After a recording with speaker separation, the note can end up never analysed with nothing said on screen and nothing recorded as an error — the same silent outcome BUG-77 is about, on the half BUG-77's fix cannot reach. | Open | BUG-77 |
| BUG-83 | A change can be blocked by a red check that has nothing to do with it: the test that searching keeps your open notes in view failed once in a full run and passed 5 of 5 on its own. Fast-follow after 51-C merges; cause still unknown. | Open | — |

Further bugs will be appended as they are identified.

---

# Detail _(diagnosis and fix direction — skip when reviewing)_

## BUG-77 — Analysis silently never runs, and the error blames the wrong thing

**Severity:** High — a core action fails with an explanation that can be actively misleading, and nothing is recorded when it happens. **Status:** Open. **Hit live** 2026-08-10 ~14:50Z on the desktop app (`1.0.0-20260810.196`); the same note analysed fine 30 minutes later.

**Confirmed defect — the mis-reporting. Fixed, PR #472.** `RecordControl.tsx:73` caught with a bare `catch {}` and discarded the error, so a dead network, an expired sign-in, a refused request and a parse error all printed one sentence that named the wrong subsystem and advised a retry that may have been incapable of working. `NoteView.handleGenerateFinalNotes` — the app's *second* way of asking for an analysis — had the same bare catch and its own catch-all sentence. Compounded by [TI-67] (RUM `CustomEvents: DISABLED` in prod), so nothing client-side was recorded either.

**What the fix changed:**

| Now | Detail |
|---|---|
| The message names the real failure | Unreachable server → *check your connection*; server fault → *temporarily unavailable*; missing note → *no longer exists*, with the retry advice dropped where a retry cannot work |
| Both entry points report the same way | `RecordControl` (button + the automatic post-recording analyse) and `NoteView`'s *Generate final notes* both route through `reportAnalyseFailure`. Two paths reporting two different ways is how this stayed invisible |
| Every **browser-side** failure emits `analyseFailed` to RUM | `kind`, `status`, `sent`, `elapsedMs`, `trigger`, `noteId`, `online`, truncated `detail`. Query in [observability.md](../observability.md#why-did-a-notes-analysis-fail) |
| A request that never left the browser is distinguishable from one the server refused | `apiFetch`'s synthetic pre-flight 401 is tagged by identity (a module-private `WeakSet`), surfaced as `ApiError.notSent` → `sent: false`. Both are 401 and neither reaches the gateway, so nothing else could tell them apart |

**The auth and forbidden arms are a fallback the user will not normally see** — any 401 whose refresh fails, and any 403, trips `triggerUnauthorized`/`triggerForbidden` first, and `App.tsx` replaces the whole screen with the session-expired banner. Verified by reading the chain (`client.ts` → `AuthContext` → `App.tsx:80`), not measured. The record still lands, which is the part that matters here.

**The server-side re-analysis is NOT covered, by construction.** When auto-analyse is on and a speaker-separation job is in play, the browser deliberately defers and the transcript-completion Lambda analyses instead — nothing fails in the browser, so no `analyseFailed` can exist. That path fails into the **TranscribeCompletion** Lambda's log group — and its common failure is logged at *Information* as `transcribe: re-analysed note {Note} → ServiceUnavailable`, which reads like a success. **Do not read an absent event as "the analysis never ran"** — establish which analyser ran first; [observability.md](../observability.md#why-did-a-notes-analysis-fail) opens with that split and with which log lines mean what. Stated as a coverage boundary only; it is **not** offered as a theory of the trigger.

**Two further reasons the browser record is not yet conclusive.** No `analyseFailed` has ever been observed arriving in prod — [TI-67] proved the channel with a different event, and this one is unwatched until it fires. And until [TI-78] lands, the RUM client's default `sessionEventLimit` of 200 drops custom events late in a long session, which is exactly when a post-recording analyse happens. Treat an absent record as unproven, not as evidence the failure did not occur.

**Trigger — still open, and a previous diagnosis is retracted.** An earlier version of this row asserted the cause was a terminally expired sign-in. **That was wrong.** The reasoning was that `apiFetch` (`client.ts:112-118`) pre-flights every call and, if the JWT is expired and the silent refresh fails, returns a synthetic `new Response(null, {status:401})` **without sending** — which would produce exactly this silent, traceless failure — and the refresh endpoint was observed failing every time.

What killed it: the session was never invalid. `CompleteTranscription` succeeded at 14:49:22.190Z on a valid token, and analysis succeeded on the **same note** at 15:19:31Z with no re-sign-in, while the refresh endpoint went on failing at 15:02, 15:07 and 15:15. "Session refresh: no rt cookie present" is continuous background noise here, not a cause — 16+ occurrences on 2026-08-10, always in pairs ~1.2 s apart, never once succeeding and never once preventing an authenticated call. That is [BUG-33]'s signature, not an expiry. The synthetic-401-without-sending path is still real code and a real candidate, but **a continuously-failing refresh that usually breaks nothing cannot explain a failure that happens only sometimes** — anything proposed as the trigger must explain the intermittency.

**Established facts to build on:**

| Fact | Detail |
|---|---|
| No `/analyse` request reached the gateway | Per-minute `Count` 14:46-14:49Z = 12/15/3/3, then **zero** 14:50-14:57Z |
| The two `4xx` at 14:58:19.4/20.7Z are accounted for | Exactly the two refresh calls behind the human's two "try again" clicks |
| The Command Lambda was **cold** at 14:49:21 | `cold_start: true` |
| The analyse path is slow | The 15:19 success took ~15 s end to end, including a **4.4 s** ICS calendar fetch before Bedrock. Whether a client-side deadline interacts with that is untested |
| The single `4xx` at 14:49Z cannot be attributed | Access logging is `None` on `$default`, and X-Ray's Lambda segments carry no HTTP URL |

**Do instrumentation before any further theory** — done: the catch is widened and [TI-67] has landed, so the channel is live. **No theory of the trigger has been advanced by this work and none should be inferred from it.** The next occurrence is the evidence; until one arrives with an `analyseFailed` record against it, the cause is unknown. [TI-63] and [BUG-58] are not ruled out as cleanly as first recorded: both would log *if the request arrived*, and arrival is exactly what is unestablished — `sent` on the new record is the field that settles it.

**Process note:** two sessions in sequence stated a cause with more confidence than the evidence carried, and it reached the human as fact. The disconfirming datum — an authenticated call succeeding inside the same window — was present in the log being read at the time.

---

## BUG-79 — An action added just after creating a note is discarded, and stalls everything behind it

**Severity:** High — silent, permanent loss of a user's action item, plus a ~30 s freeze of every other read. **Status:** Open, cause CONFIRMED 2026-08-11 from the deployed test environment's own logs. Raised 2026-08-10 from E2E run [#164](https://github.com/simonkirkham/ai-note-taker/actions/runs/31406829746).

**What the user gets:** they make a note and immediately add an action to it. The action never appears again — not after a reload, not ever. For the next ~30 seconds nothing else they do updates either.

**Confirmed cause.** The component that builds read models refuses to record an action against a note whose own read model has not been written yet, and it does so by throwing. `ProjectionUpdater.ApplyActionItemAddedAsync` (`src/Api/Projections/ProjectionUpdater.cs`) raises `NoteNotFoundException` when `noteDetailStore.GetAsync` returns null. The note and the action are separate streams and DynamoDB Streams give no ordering between different keys, so when the action is added within about a second of the note, the action's record can arrive first. The throw fails the whole Lambda batch, so the stream retries it, and every other stream sharing that shard waits behind it.

**The measured sequence** (E2E test account 739754704263, `eu-west-2`, all timestamps read from CloudWatch on 2026-08-11):

| Time (UTC, 2026-08-10) | What happened |
|---|---|
| 16:05:00.233 | note `ea24f4e8…` created |
| 16:05:00.814 | action `9896cded…` added — 581 ms later |
| 16:05:01.237 → 16:05:02.988 | **5 consecutive** `Projector batch failed (1 streams)`, every one `NoteNotFoundException: Note ea24f4e8… not found` |
| 16:05:31.188 | the note stream finally folded, **`lag 30834.918ms`** — the shard had been blocked for 30.8 s |
| — | `Projector applied action#9896cded…` **never appears**, across a 7-minute search. The action was never folded at all |
| 16:05:33 | the E2E journey gave up after its 30 s deadline |

**This is the cross-key-order hazard the row already suspected — but on the WRITE side, not the read gate.** CLAUDE.md's guardrail warns about *gating a read* on one stream while reading a projection built from another. The same absence of ordering bites here while *building* the projection, and the consequence is worse than a slow read: a throw poisons the batch, the retry cannot succeed (the note it needs is itself stuck behind the same failed batch), and the action is dropped.

**Fix direction:** the action fold must tolerate a not-yet-folded note instead of throwing. Either seed the action against the note id alone and backfill the denormalised title/workspace when the note folds, or re-drive the note's stream first from within the action fold. Whatever the shape, a missing prerequisite projection must not fail the batch — that converts an ordering race into permanent loss plus a shared stall.

**Ruled out, with the evidence** (each was a live hypothesis before this investigation):

| Ruled out | Why |
|---|---|
| The card/action list read is eventually consistent or truncated | `DynamoDbNoteCardListStore.QueryAllAsync` paginates on `LastEvaluatedKey` and passes `ConsistentRead = true` |
| CloudFront strips `If-Consistent-With` before the origin sees it | the `/api/*` behaviour uses `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER`, so every viewer header is forwarded |
| CloudFront served a cached list | the same behaviour uses `CachePolicy.CACHING_DISABLED` |
| The read-your-writes gate is broken | the gate logged `RYW gate fresh` for the streams involved, and the projector's recorded position is only advanced *after* every projection for that stream is written |
| The reads were never gated | the probe now records the outbound token per request and the self-check proves it discriminates — see below |

**The probe was fixed first, and its discrimination is proved, not asserted.** The old diagnostic reported only the response header, which the server sets on a stale read *only* — so a gated-and-fresh read and a read carrying no token at all were byte-identical evidence, and the row correctly refused to draw a conclusion from it. `ConsistencyProbe` now records the request's outbound `If-Consistent-With` (visible only from inside a Playwright route) plus a third state for a read issued and never answered. `ConsistencyProbeSelfCheckJourney` manufactures a gated and an ungated read one manipulation apart and fails if they report the same: **green twice** on the real deployed app (E2E run [#175](https://github.com/simonkirkham/ai-note-taker/actions/runs/31542436234)), and **red** with the exact "cannot tell them apart" message when the probe was deliberately blinded to the outbound header (run [#177](https://github.com/simonkirkham/ai-note-taker/actions/runs/31542658092), branch `proof/bug-79-probe-blind`).

**The self-check needed a self-check, and the first fix for it was wrong.** Its first two 10-run batches were **6 passed / 4 failed** ([#179](https://github.com/simonkirkham/ai-note-taker/actions/runs/31544406237)) and **5 / 5** ([#180](https://github.com/simonkirkham/ai-note-taker/actions/runs/31571731104)), both reporting that the probe could not tell a gated read from an ungated one.

The first diagnosis — "the app issues two actions reads after a reload and the helper sampled the second" — was **wrong**, and is recorded here rather than quietly replaced. It was refuted by the per-arm dump added alongside it, which reported `reads=1`: there was never a second read.

The actual race: the token was seeded into the **live page** before reloading, and adding an action leaves a refetch in flight. That refetch returns non-stale, so `gatedRead` clears the very key just written, and whether it did so before the reload was a coin flip. Seeding through a Playwright **init script** puts the value in the next document before any app code runs, where nothing is alive to clear it; the ungated arm runs first because an init script cannot be removed. **10 passed, 0 failed** on that fix ([#181](https://github.com/simonkirkham/ai-note-taker/actions/runs/31572833088)).

Worth keeping for two reasons. The failure was the same shape as the bug — something that looked like a property of the system was a property of when it was measured. And the first fix was believed on reasoning alone; what refuted it was a field in the instrument's own output, which is the argument for making a diagnostic explain its own failures.

**Frequency, measured 2026-08-11:** `gh workflow run e2e.yml --ref slice/bug-79-read-your-writes -f runs=10` over `ActionReadYourWrites` + `OpenNoteTabs` — **10 passed, 0 failed** (run [#178](https://github.com/simonkirkham/ai-note-taker/actions/runs/31542845086)). The window is narrow: the note fold has to lose the race by a few hundred milliseconds, so a clean 10 does not clear the defect, it only bounds how often the race is lost.

**Retracted from the original write-up:** "a read that never gates at all" as the leading explanation, and the reading of the earlier note-case evidence as a read-your-writes failure. That case was a different defect entirely — see [BUG-81].

---

## BUG-81 — Clicking Save on a new note can delete it

**Severity:** High — silent, unrecoverable loss of a note the user just wrote, on the single most ordinary action there is. **Status:** Open, strongly supported by the deployed environment's logs; the final step is observed by inference, not directly. Split out of [BUG-79] on 2026-08-11.

**What the user gets:** they make a note, type a title, and click Save. The note is deleted. Nothing warns them, and it does not come back.

**How it happens.** The Save button and the Cancel button occupy the same place in the note header, and which one is rendered depends on whether the note looks empty (`NoteView.tsx`, the `hasContent` branch in the note header). For a brand-new note, Cancel does not merely go back — it deletes the note (`handleCancel` in `NoteView.tsx`). The note momentarily looks empty right after a successful rename: the displayed title is `titleDraft ?? detail?.title ?? initialTitle` (the `title` binding in `NoteView.tsx`), the rename's success handler clears `titleDraft`, and the note-detail read that was already in flight when the rename happened comes back carrying the note as it was *before* the rename — with no title — and overwrites the cache the rename had patched (`useRenameNoteDetail`, `useNoteDetailMutations.ts`, which never cancels the in-flight query). For that window the header shows Cancel where Save was, and a click already on its way lands on Cancel.

**The measured sequence** (E2E test account, from CloudWatch on 2026-08-11; E2E run [#169](https://github.com/simonkirkham/ai-note-taker/actions/runs/31414289871)):

| Time (UTC, 2026-08-10) | What happened |
|---|---|
| 17:30:55.37 → .55 | note `8b7cdd87…` created, assigned a workspace, given a date |
| 17:30:55.928 | `NoteRenamed` — the title is saved |
| 17:30:56.068 | the note-detail read returns `outcome=Fresh result=Hit` — but its own latency (209 ms) puts its start at ~17:30:55.86, 69 ms *before* the rename was written |
| ~17:30:56.11 | the rename is folded into the read model (`NoteRenamed lag 182.06ms`) — **43 ms after** the read above was served, so that read provably carried the note with no title |
| 17:30:56.367 | **`NoteDeleted`** — from a browser request (`HeadlessChrome` user agent), 299 ms later |
| 17:31:35.7 | the journey gave up looking for a card that no longer existed |

**Why the delete can only have come from Cancel.** The test never asks for a delete, and only two notes existed in that window — both this journey's. The app has exactly two paths to a delete: the Delete button, which is rendered **only when the note is non-empty**, and Cancel, which is rendered **only when it is empty** and which deletes a new note. A delete demonstrably happened, so the click landed on Cancel, which requires the note to have been rendering as empty at that instant.

**Recurred 2026-09-11, deploy #776** (attempt 1, `OpenNoteTabsJourney.OpenTwoNotes_SwitchBetweenTabs_CloseOne`, after 16 clean deploys): the title PATCH was acknowledged, Save was clicked, and a `/notes/cards` read gated fresh at the note's version 5 still had no card for it. Same signature as #169. Not confirmed as a delete — the uploaded trace is another journey's, and this machine had no AWS keys to read the E2E account's logs. The deploy was re-run as a proven flake.

**What is NOT directly observed:** the button swap itself. Confirming it means catching the control's identity at click time — record the `data-testid` actually hit, or assert no `DELETE /notes/{id}` fires during a save. That check does not exist yet and should come with the fix.

**Fix direction:** two independent problems, and both are worth closing. (1) A destructive action must never occupy the same position as a non-destructive one, and must never appear under a cursor already moving toward the other — keep Cancel and Save in fixed, distinct positions, and never let a note flip to "empty" while a rename is settling. (2) The rename must cancel the in-flight note-detail query (`qc.cancelQueries`) before patching the cache, or an older response will keep overwriting a newer local truth. The second is the narrower fix; the first is what stops the class.

## BUG-84 — Analysing a longer meeting times out, and the advice to retry cannot work

**Severity:** High — the app's core output never appears for exactly the meetings that matter most, and the on-screen advice sends the user round a loop that cannot succeed. **Status:** Open. Found by observability review 2026-09-16.

**Symptom:** you press *Analyse note* or *Generate final notes* on a meeting of any real length. The spinner runs ~23 s, then *"Analysis is temporarily unavailable. Try again in a minute."* Trying again fails the same way, every time.

**Prod evidence (last 30 days, measured 2026-09-16):**

| Measure | Value |
|---|---|
| In-app analyses (button, final notes, auto-analyse without speaker separation) | **9 — 2 succeeded, 7 failed**, every failure `Bedrock analysis exceeded its 23s deadline` → `TimeoutException` |
| One note retried three times | `cb037bb6…` failed at 14:04:55, 14:05:24 and 14:27:48Z on 2026-09-07 |
| Server-side re-analyses (after speaker separation, 45 s limit) | 21 — 18 succeeded, **3 failed at the 45 s limit** (2026-08-19, 09-02, 09-07) |
| Successful analysis duration, weekly p50 since 2026-08-12 (`AnalysisDurationMs`) | 24 s, 36 s, 10 s, 24 s, 36 s. Max **44.5 s** — within 0.5 s of the server-side limit |
| `notetaker-analysis-failed` alarm | Fired 7 times in 30 days; working as designed |

**Root cause:** the in-app path runs analysis inside the 29 s Command Lambda with a 23 s model deadline ([BUG-58], `src/Api/Builder.cs:242`). That deadline was sized on the **previous** model, whose calls had a 2.6 s median. The prod model moved to Opus 4.6 on 2026-07-23 (MPI-11); a typical successful analysis now takes longer than the whole in-app budget. `MaxTokens = 2048` (`BedrockAnalysisService.cs`) lets a long meeting generate for well past 23 s. Two notes (`5607fb6b…` 2026-09-02, `6bfc279e…` 2026-09-07) failed in-app and then on the server-side path minutes later, so for the longest meetings neither path completes.

**Observable?** Yes on the server — Error log, `AnalysisFailed` metric, alarm. Invisible to the user as a *class*: each failure reads as a one-off outage. Not visible in the browser record at all from the desktop app ([TI-98]).

**Fix direction:**
1. Durable: [TI-63] — run analysis off the request path with a longer limit, and let the note show "analysing…" until it lands. Its "~12-19% of analyses near or over budget" sizing predates the model change and is now wrong.
2. Stop-gap until then: stop telling the user to retry a timeout — say the meeting is too long to analyse in-app — and raise the server-side 45 s limit towards the 60 s Lambda ceiling, since successes already reach 44.5 s.

**Not a theory of [BUG-77]'s trigger.** BUG-77's occurrence never reached the server; every failure here did.

---

## BUG-85 — The live transcript stops part-way through a meeting and nothing says so

**Severity:** High — most of a meeting's transcript is lost for good, and the user only finds out afterwards. **Status:** Open. Found 2026-09-16 while tracing the "OGI: CL Scrum of Scrums" note (`0e666ad4…`).

**Symptom:** a recording shows as running for the whole meeting. The saved transcript covers only its first part and ends mid-sentence. Speaker separation was not run, so nothing re-transcribed the audio afterwards.

**Prod evidence (desktop build `1.0.0-20260811.211`, cloud live transcription):**

| Time (UTC) | What happened |
|---|---|
| 10:34:06 | Note created and linked; one live stream opened (`AWS/Transcribe` `TotalRequestCount` = 1 at 10:34, no reconnect after) |
| 10:34 → 11:08 | Command Lambda took 2-4 calls a minute — the 15 s draft autosave, which only fires when new finalised text has arrived (`useTranscription.ts` `saveCheckpoint` dedupe) |
| **11:08 → 11:59** | **Zero** Command Lambda calls. No new finalised text for 51 minutes |
| 12:02:40 | `TranscriptionCompleted`: `DurationSeconds` 5302 (88 min), 6,291 words, ending mid-sentence. No analysis request followed; the user saw an error |

6,291 words over the 34 minutes to 11:08 is ~185 words/min — a normal speaking rate. The transcript is most likely complete up to 11:08 and empty after it.

**Second occurrence, 2026-09-17 — "Crosslake Town Hall" (`bc0e9df2…`), now with the health record [TI-99] added for exactly this.**

| Time (UTC) | Health record |
|---|---|
| 15:03:53 | Recording starts; one stream, cloud engine. Credentials issued once, valid 15 min (`StsCredentialService` `DurationSeconds = 900`) |
| 15:04-15:32 | Normal: `covered` tracks `duration` within a few seconds, ratio 0.99-1.00 |
| **15:32:38** | **Last finalised text. `covered` freezes at 1724.7 s (28.7 min) and never moves again** |
| 15:35:11 → 19:03:14 | 47 `end=stalled` Warnings. `sinceLastAudio=0s` throughout — the app keeps pushing audio — while `sinceLastText` climbs to 12,628 s and the ratio falls 0.92 → 0.12 |
| 19:03:57 | `end=error`, `error=object: -` — a non-`Error` value thrown at **exactly 14,400 s = 4 h**, AWS Transcribe streaming's documented maximum session length. The stream had stayed open the whole time |
| 2026-09-18 08:49:35 | The user recovered the draft: 5,433 words, 30 KB. 189 words/min over the 28.7 min captured — a normal rate, so the text is complete up to the stop and empty after it |

**What this rules in and out.**

| Candidate | Verdict |
|---|---|
| The stream errored at the stop | **Out.** It stayed open 3.5 h past the stop and ended only at AWS's 4 h cap |
| The app stopped sending audio | **Out** as written: the app kept pushing buffers (`sinceLastAudio=0s`) |
| **The captured audio went silent or its track died** (the meeting's shared-audio capture ended, a device changed) | **The leading candidate, and untestable today.** `audioSecondsSent` counts buffers pushed, not sound: a dead or silent track still yields zero-filled buffers at the same rate. The app never listens for a track's `ended`/`mute` event (`useTranscription.ts:493-512`) and never measures level, so silence and a dead source are indistinguishable from real speech |
| Credentials expiring mid-recording | **Open, unlikely as the trigger.** They are issued once for 15 min and never refreshed, so every recording over 15 min runs on expired credentials — but text continued for 13.8 min past expiry, and the stream stayed open for hours |

**What it cost:** the meeting ran on past 15:32 and none of it was transcribed. Nothing on screen said so for 3.5 hours.

**Research pass, 2026-09-18 (AWS docs + the installed SDK's source). The leading candidate is now much stronger, and two of the facts were mis-read.**

| Established | Source |
|---|---|
| **The service ends a stream that stops receiving audio after ~15 s.** Ours survived 3.5 h, so the app was genuinely sending bytes the whole time — and the service was accepting them | Widely reported (`Your request timed out because no new audio was received for 15 seconds`); not in AWS's own docs |
| **Digital silence is a valid, expected input** — AWS's own best practice is to keep sending zero bytes when there is no speech. Results are emitted per speech segment, so silence produces no partials and no finals, indefinitely, on a healthy connection | [streaming.html](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html), [partial results](https://docs.aws.amazon.com/transcribe/latest/dg/streaming-partial-results.html) |
| **4 h is the documented maximum session length**, a hard limit — so the 14,400 s ending is expected, not a fault | [Transcribe FAQs](https://aws.amazon.com/transcribe/faqs/) |
| **The non-`Error` thrown value is the SDK, not the service.** This client runs over WebSocket, and `@aws-sdk/middleware-websocket` throws the raw DOM `Event` from `socket.onerror` — no `name`, no `message`. An abnormal close (1006) produces exactly the `error=object: -` we logged | Read in `web/node_modules/@aws-sdk/middleware-websocket/dist-cjs/index.js` |
| Every service-side rejection — expired token, bad signature, throttling, limit — is documented and reported to **close the stream with an error within seconds**. None sits open and silent | [streaming-setting-up.html](https://docs.aws.amazon.com/transcribe/latest/dg/streaming-setting-up.html) + issues [7443](https://github.com/aws/aws-sdk-js-v3/issues/7443), [7496](https://github.com/aws/aws-sdk-js-v3/issues/7496) |

**So the audio almost certainly went silent at 28m45s, and the service behaved correctly throughout.** Zero partials is the decisive fact: no service-side failure produces that while holding a connection open. A Chromium variant makes it worse — a capture track can go silent **without** changing `muted`, `enabled` or `readyState` on a device change (e.g. a USB headset connecting), so even watching track state would not always catch it.

**Two corrections to earlier notes here.** "The app kept sending audio" is true but proves only that bytes flowed, not that they carried sound. And the audio is **not** available to check: the error path tears down without uploading (`useTranscription.ts:748-752`), the recordings bucket is empty, and nothing is kept on disk unless "keep recordings on this device" is on, which applies to the on-device engine only.

**Two further defects found while researching, both open:**
1. **Credentials are resolved once per stream and never refreshed** — the SDK caches them at stream construction (`eventStreamCredentials: await staticCredentials`), so no refreshing provider can help. Every recording over 15 min runs on an expired token. Not this symptom, but real.
2. **A clean server close ends the result loop with no error at all**, and the app treats that as a normal end (`streamEnded` → commit). A stream that died at minute 29 and a recording the user stopped take the same path.

**The documented pattern for long recordings is to reopen, not to refresh:** a fresh `StartStreamTranscription` reusing the same `SessionId` within `SessionResumeWindow` (1-300 min), with the client stitching the results.

**Root cause: narrowed, not established.** Candidates:
1. The stream errored. The catch in `useTranscription.ts` sets `status: 'error'` and shows the error text, but does not save the transcript captured so far.
2. The audio source stopped delivering chunks, for example a device change or the shared-audio capture ending. `audioStream()` then waits forever, and the service ends the stream for lack of audio.
3. The stream stayed open but returned no finalised results.

Nothing records which one happened: the desktop build sends no browser telemetry ([TI-98]), and AWS publishes no per-stream end or error metric for streaming.

**Observable?** No, except by inference from the draft-autosave cadence. That method is now in [observability.md](../observability.md#why-is-a-transcript-incomplete). [TI-99] adds the direct signal.

**Fix direction (in this order):**
1. **Tell the user — slice 1, in progress.** After ~2 min with no new text the recording control says how long it has been since any words were transcribed, names which of the three cases it looks like, and says what to do. It states the fact rather than asserting a fault: a meeting can be quiet for two minutes, and a restart prompted on a working recording makes a good recording worse. **How much it would have saved on 2026-09-17 is unknown** — it saves time only if the user is looking at that note's screen while it happens, and the earlier row's claim that it "would have saved 3.5 h" assumed that without evidence.
2. **Tell silence from a dead source — slice 1, in progress.** Every captured track is watched for `ended`/`mute`/`unmute`, and the level of the audio actually captured is measured in the existing processing path. A sample counts as sound only if it survives 16-bit quantisation (1/32767, about −90 dBFS) — below that the app is transmitting zeros, which is exactly what a dead or muted track produces. Two solid minutes under that floor is silence. The three facts (source ended, muted, silent and for how long) ride the health record to the server; older builds keep working and log them as absent.
3. **Reopen the stream — slice 2, not started.** When text has stopped while real audio is arriving, reopen with fresh credentials (which also removes the expired-credential exposure on any recording over 15 min).

**What slice 1 does NOT do.**

| Not done | Consequence |
|---|---|
| No notice anywhere but the recording note's own screen | Looking at another note, or another app, and you see nothing. The recording control unmounts when you leave the note |
| No stream reopening, no credential refresh | A stopped transcript still has to be stopped and started by hand. That is slice 2 |
| No audio retention for the lost stretch | Nothing re-transcribes what was missed. The live transcript is still the only record unless speaker separation ran |
| Nothing watched working against real hardware | The classification is proved against test doubles only; whether a real dead track reports as this code expects is settled by the next occurrence |

Slice 1 makes the situation visible while it is happening and gives the server the evidence to settle the leading candidate. It does not prevent the loss. **The measurement is the point of this slice — the notice is secondary.**

Reproduce by ending the shared-audio capture mid-recording on a desktop build and watching for "timer running, no text".

---

## BUG-70 — "+ New Note" while recording leaves an orphan note behind

**Severity:** Medium — clutter, not loss, but the app creates something the user explicitly declined. **Status:** Open. Pre-existing since [BUG-54] added the guard; surfaced by [CHANGE-33] review.

**Symptom:** clicking "+ New Note" mid-recording creates a real, dated, empty note. Choosing "Keep recording" abandons the navigation but not the note, which then shows on the home list as an untitled blank card the user never made.

**Cause:** `handleNewNote` (`web/src/App.tsx`) creates the note **server-side first** — `createNote` → `setNoteDate` → optional `moveNote` — and only then calls `openNote`, which is where the [BUG-54] recording guard runs. CHANGE-33's new "Still recording — open the new note?" copy makes the promise explicit, and it correctly names a note that does exist.

**Fix direction:** ask before creating, not after — route the guard around the whole of `handleNewNote` (`requestLeave(() => void handleNewNote(), "open the new note")`) so a declined leave never reaches the create. Check `handleOpenNextOccurrence` and the `/ai` create-note path in `NoteView` for the same create-then-guard ordering. Frontend-only; no event, projection or endpoint change.

**Unblocked 2026-09-11 — 51-C merged (#468).** It removed the leave-prompt from `openNote`, which `handleNewNote` calls, so re-check first whether the orphan can still happen: it existed only when the user declined that prompt. If it cannot, close this bug; if another create-then-guard path still produces it (`handleOpenNextOccurrence`, the `/ai` create-note path), fix that one.

---

## BUG-73 — A confirmed sign-out can park for up to an hour with no way out

**Severity:** Medium — no data loss on the common path, but no escape either. **Status:** Open. Found by review of [BUG-55].

**Symptom:** [BUG-55] makes the sign-out continuation wait for the on-device transcript commit, which is correct — an un-awaited POST 401s and the transcript is lost. But the wait is `clamp(recordedMs × 1.95, 2 min, 60 min)`, so on a long local recording someone who has already confirmed "Leave & save" sees "Finishing the transcript…" and has no exit until it lands or the deadline expires. On a shared machine that is a real problem: they cannot sign out.

**The ceiling also caps the protection.** Above ~31 minutes of audio it binds before the derived deadline, so a very long local 1:1 can still expire mid-pass and lose the transcript — BUG-55 recurring at a higher threshold.

**Fix direction:** a "Sign out now" control in the parked banner that abandons the wait deliberately, warning that the transcript may not save. That removes the trade entirely — the deadline no longer has to be both short enough to be escapable and long enough to be sufficient.

---

## BUG-75 — A note reopened mid-finalise shows no transcript until you navigate again

**Severity:** Low — recoverable and self-correcting on the next navigation. **Status:** Open.

**Symptom:** reopening a note before the on-device commit lands serves a cached detail with no transcript, and nothing refetches when the commit completes.

**Cause:** `commitTranscript` only POSTs — it never invalidates `keys.note` — and the query client runs `staleTime: 30_000` with `refetchOnWindowFocus: false`.

**Why it surfaces now:** the mechanism predates [BUG-72], but that fix **widens the window** on the leave-mid-finalise path from roughly zero (the commit used to fire during the navigation) to the whole finalise duration — minutes.

**Mitigated by** `detail.transcriptDraft`, which still offers the live text for recovery; a later real commit supersedes a recovered draft.

**Fix direction:** invalidate `keys.note(noteId)` after a successful commit.

---

## BUG-78 — A malformed sign-in link blocks session restore and loops a storage warning

**Severity:** Low — needs a hand-edited or truncated address to reach. **Status:** Open. All found by review of [BUG-71]; all **pre-existing** and not regressed by it, which is why that PR keeps `has('code')` rather than folding a session-restore change into a gate-strand fix.

**Symptom:** you are dropped at the sign-in screen instead of straight back into your notes, and told your browser is blocking storage — a message that returns on every reload, for as long as you keep that link.

**Cause:** `AuthContext` derives `hasOAuthCode` from `searchParams.has('code')`, but the exchange effect requires a **truthy** `code` at every branch. The consumers therefore diverge from the effect they predict:

| # | Consumer | What goes wrong |
|---|---|---|
| 1 | `shouldBootstrapRefresh` | Suppressed, so a user arriving at `/?code=` with a valid refresh cookie is shown the sign-in screen instead of being restored — the [BUG-15] regression this derivation exists to prevent (reproduced: zero refresh calls) |
| 2 | [BUG-60]'s `storageBlocked` seed | Renders its "browser is blocking storage" message, while the effect arm that would strip `?code=` and emit the signal declines to run — **so the code stays in the address bar and the message returns on every reload**, exactly the indefinite loop BUG-60's strip exists to break |
| 3 | The `initialToken` path | The effect returns before any arm, so the message shows and nothing is stripped. E2E-only (`window.__E2E_AUTH_TOKEN`); no real user reaches it |

**Fix direction:** derive all three consumers from a truthy `code`. Note that `staleCalendarState.test.tsx`'s empty-code case asserts today's behaviour — this fix owns flipping it.

---

## BUG-80 — A topic added from the header can land in a checklist the note does not show

**Severity:** Low — needs the note to already contain a checklist indented under a bullet. **Status:** Open. Found by review of [BUG-76](phase-bugs-archive.md#bug-76--the-agenda-count-disagreed-with-the-ticks-on-screen); **pre-existing**, and not a regression from it — placement was the same before that fix. Parity holds throughout: the header and the server agree on the count, so nothing is miscounted and no command touches the wrong line.

**Symptom:** you type a topic into the agenda strip, it appears in the list, and it is nowhere in the note where you expect it. It has been written into an empty checklist sitting above the first line of the note, which renders as an empty checkbox rather than as the heading the other topics sit under. Editing it in the note means finding it there first.

**Cause:** on a body like `- Shopping` / `  - [ ] Milk` / `- [ ] Bread`, tiptap-markdown parses a **stray empty top-level `taskList`** ahead of the bulleted list. `firstReadableTaskList` (`web/src/lib/agendaEditorApi.ts`) returns the first `taskList` the read walk reaches in document order, which is that empty one — so the new item is appended to it, at the top of the note, instead of joining the checklist the header is showing.

Reproduced against a real editor: adding `Renewals` to that body yields `- [ ] \n- [ ] Renewals\n\n- Shopping\n  - [ ] Milk\n\n- [ ] Bread` and a topic list of `Renewals, Milk, Bread`. When there is no stray list — `- Shopping` / `  - [ ] Milk` — placement is already correct and the item joins the nested checklist.

**Fix direction:** choose the target list from a `taskList` that actually yields a countable topic, falling back to the first one only when none does. That makes the function's name true and puts the new topic with the ones on screen. The blockquote exclusion must survive: a quoted checklist is never a target, because the walk never reads it.

---

## BUG-82 — A server-side re-analysis can fail silently, with a log line that reads like success

**Severity:** Medium — same user-visible outcome as [BUG-77] (a recording that never gets analysed, no explanation), on the path BUG-77's fix cannot cover. **Status:** Open. Found by review of [BUG-77] (PR #472); **pre-existing**, not a regression from it.

**Symptom:** you finish a recording with speaker separation on and auto-analyse on. The note is never analysed. Nothing appears on screen — no error, no retry prompt — because the browser deliberately handed the analysis to the server and has nothing to report.

**Why nothing surfaces it:**

| Layer | What happens |
|---|---|
| Browser | `RecordControl` defers the on-Stop analyse while diarization is `refining`/`timedOut` (33-B2, correct — the server re-analyses on the winning transcript). No request, so BUG-77's `analyseFailed` event cannot exist here, by construction |
| Server | `MaybeAnalyseAsync` (`src/TranscribeCompletion/TranscribeCompletionFunction.cs:164`) logs `transcribe: re-analysed note {Note} → {Outcome}` at **Information** — including when the outcome is `ServiceUnavailable`. Success-sounding wording for a failure |
| Server, error path | The outer `catch` at `:168` (`transcribe: re-analysis failed…`, Error) never fires for the common case: `NoteAnalysisService` catches Bedrock/`InvalidOperationException`/`TimeoutException` and **returns** `ServiceUnavailable` rather than throwing (`src/Api/Services/NoteAnalysisService.cs:66-72`) |
| Alarms | The shared service does emit `AnalysisFailed` and an Error log in the completion Lambda's group, so the signal is not absent — but nothing ties it back to the user, and nothing tells them |

**Fix direction:** treat a non-`Analysed` outcome in `MaybeAnalyseAsync` as a failure — log it at Warning/Error naming the outcome, and give the user a way to find out (the note has no summary and no explanation). Consider whether the note should carry a "not analysed" state the UI can show, rather than looking identical to a note nobody asked to analyse.

**Prod evidence, 2026-09-16 review:** 3 of 21 server-side re-analyses in the last 30 days failed this way, all at the 45 s model deadline — see [BUG-84].

**Not a theory of [BUG-77]'s trigger.** This was found by reading the code while documenting what BUG-77's browser-side record does *not* cover. Whether the 2026-08-10 occurrence came through this path is unknown and unevidenced — the two share a symptom, nothing more.

---

## BUG-83 — The "searching keeps my open notes in view" test fails at random under load

**What it costs:** a full frontend test run goes red for a reason unrelated to the change under test — a local run that sends someone diagnosing the wrong thing, or a PR check that blocks a merge until re-run.

**Evidence, 2026-09-11** (found while fixing 51-C review round 5, on `slice/51-c-recording-tab`):
- Failed once in a full `npx vitest run` (1224 passed, 1 failed), on a Windows ARM laptop.
- Passed 5 of 5 run alone, and in the next full run.
- Not touched by 51-C: the branch's diff to `OpenNoteTabs.test.tsx` leaves this spec unchanged. It came in with 51-B (#452).

**Cause: unknown.** The failure took **231 ms** — an assertion failing fast, not a wait running out. `waitFor`'s timeout is ruled out: locally the budget is already 4 s (`src/test/setup.ts`, TI-61), and a 5 s timeout was tried and reverted for that reason.

**Reproduction attempt, 2026-09-11:** 4 more full runs, all clean (1225/1225), before the machine ran low on memory and the loop was killed. So far 1 failure in 7 full runs on this laptop, none in CI.

**Next step:** capture the assertion text when it next fails — in CI, `scripts/ci-logs.sh <pr>` on the red `frontend` check; locally, keep the full `npx vitest run` output instead of a filtered tail.

## BUG-86 — On-device speaker labels put the other side's words under "Me" too

**Severity:** High — the labelled transcript is unreadable whenever a call plays through speakers, which is the default for a laptop. **Status:** Open. Found 2026-09-18 by the user, testing on-device transcription against a YouTube video (note `e65ad62a…`, Default workspace).

**Symptom:** the saved transcript alternates `Me:`/`Them:` line by line, and the two lines say the same thing. `Them:` is the video, cleanly. `Me:` is the same video, slightly re-worded ("Baros" vs "far us", "authentic engineering" vs "agentic engineering"). The user's own sentence ("If I speak now, can you identify it as a different person? No, you can't.") is present, but inside a `Me:` turn that also carries the video's words.

**Cause:** the microphone hears the speakers. 48-C labels by source — mic = Me, system audio = Them — and assumes the mic carries only the user. With speakers on, the mic stream also carries the other side, so the Me pass transcribes it a second time. The split itself ran: the Windows process list at 13:49:48 UTC showed `whisper-cli.exe … ggml-small.en.bin … --vad -vm ggml-silero-v5.1.2.bin`, the per-source pass.

**Not the cause:** the browser's echo cancellation. It only removes audio the same page plays, so it cannot remove a YouTube tab or a Teams window.

**Cause confirmed 2026-09-18:** the user re-ran the same test on headphones (note `5c874d7d…`). Labels came out clean: every `Them:` line is the video, every `Me:` line is the user, with no duplicates. So the split works; only the speaker-to-mic echo defeats it.

**Fix directions (hypotheses, not a spec):**
1. Drop a `Me` segment whose words largely match a `Them` segment overlapping it in time — the echo is a near-duplicate, delayed by milliseconds.
2. Gate the mic by the loopback: suppress mic frames where loopback energy is high and mic energy tracks it.
3. Both need a real speakers-on recording kept as a fixture — the current specs use synthetic separate streams, which structurally cannot contain echo.

Related: [BUG-87] (the same stop-time pass is also slow).

## BUG-87 — "Finalising transcript…" takes almost as long as the meeting

**Severity:** Medium — nothing is lost, but the note has no labels and no analysis for close to the meeting's length after it ends. **Status:** Open. Found 2026-09-18 by the user (same test as [BUG-86]).

**Measured (this machine, 2026-09-18, from `local-transcription.log` and the Windows process list):**

| Step | UTC | Took |
|---|---|---|
| Recording | 13:44:23 → 13:48:09 | 3 m 46 s of audio |
| Pass 1 (mic, `small.en` + VAD) | 13:48:09 → 13:49:48 | ~1 m 39 s |
| Pass 2 (system audio, `small.en` + VAD) | 13:49:48 → 13:51:31 | ~1 m 43 s |
| Total finalising | | **3 m 22 s ≈ 0.9 × the recording** |

**Cause:** as designed, not a malfunction. The 1:1 split re-transcribes the WHOLE recording twice with the larger model, one after the other (`diarizeStreams` in `desktop/src/localTranscription.ts`). The budget comment in `useTranscription.ts` already predicts 0.87 × audio. The live `base.en` transcript is discarded when the split succeeds, so none of the live work is reused.

**Fix directions (hypotheses):**
1. Run the two passes in parallel (each is capped at half the cores, so together they would use the machine rather than wait).
2. Label from the live transcript instead of re-transcribing: the live pass already knows when words were said; tag each by which source was louder at that moment. Cost near zero, and it would also give live labels ([CHANGE-44]).
3. Keep `small.en` only for the Them side, where quality matters most.
