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
| BUG-77 | You finish a recording, the note is never analysed, and the only thing you are told is "Analysis failed. Please try again." The message is often wrong about what actually went wrong. | Open | TI-67, BUG-33 |
| BUG-79 | An action item you add in the first second or two after making a note is silently thrown away for good, and while that happens everything else you do for the next half minute stops updating. | Open | — |
| BUG-81 | Typing a title on a brand-new note and clicking Save can delete the note instead — the button changes from Save to Cancel under your cursor, and Cancel throws a new note away. | Open | — |
| BUG-70 | Clicking "+ New Note" while recording and then choosing to keep recording still leaves a blank, untitled note behind on your home list. | Open — held behind 51-C | BUG-54, 51-C |
| BUG-73 | Signing out while an on-device transcript is still finishing can park you for up to an hour with no way to leave — a real problem on a shared machine. | Open | BUG-55 |
| BUG-75 | Reopening a note while its on-device transcript is still finishing shows no transcript, and nothing appears until you navigate again or reload. | Open | BUG-72 |
| BUG-78 | A truncated or hand-edited sign-in link drops you at the sign-in screen and claims your browser is blocking storage — and the message comes back on every reload. | Open | BUG-71, BUG-60, BUG-15 |
| BUG-80 | A topic you add from the agenda strip can land in an invisible checklist at the very top of the note — the header lists it, but you cannot find it in the note to edit it in place. | Open | BUG-76 |

Further bugs will be appended as they are identified.

---

# Detail _(diagnosis and fix direction — skip when reviewing)_

## BUG-77 — Analysis silently never runs, and the error blames the wrong thing

**Severity:** High — a core action fails with an explanation that can be actively misleading, and nothing is recorded when it happens. **Status:** Open. **Hit live** 2026-08-10 ~14:50Z on the desktop app (`1.0.0-20260810.196`); the same note analysed fine 30 minutes later.

**Confirmed defect — the mis-reporting.** `RecordControl.tsx:73` catches with a bare `catch {}` and discards the error, so a dead network, an expired sign-in, a refused request and a parse error all print one sentence that names the wrong subsystem and advises a retry that may be incapable of working. Compounded by [TI-67] (RUM `CustomEvents: DISABLED` in prod), so nothing client-side is recorded either. **This half is fixable now, independently of the trigger:** keep the status and message, and let an unauthenticated result say *sign in again* rather than blaming analysis.

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

**Do instrumentation before any further theory** — widen the catch and land [TI-67]. A second occurrence is otherwise as blind as the first. [TI-63] and [BUG-58] are not ruled out as cleanly as first recorded: both would log *if the request arrived*, and arrival is exactly what is unestablished.

**Process note:** two sessions in sequence stated a cause with more confidence than the evidence carried, and it reached the human as fact. The disconfirming datum — an authenticated call succeeding inside the same window — was present in the log being read at the time.

---

## BUG-79 — An action added just after creating a note is discarded, and stalls everything behind it

**Severity:** High — silent, permanent loss of a user's action item, plus a ~30 s freeze of every other read. **Status:** Open, cause CONFIRMED 2026-08-11 from the deployed test environment's own logs. Raised 2026-08-10 from E2E run [#164](https://github.com/simonkirkham/ai-note-taker/actions/runs/31406829746).

**What the user gets:** they make a note and immediately add an action to it. The action never appears again — not after a reload, not ever. For the next ~30 seconds nothing else they do updates either.

**Confirmed cause.** The component that builds read models refuses to record an action against a note whose own read model has not been written yet, and it does so by throwing. `ProjectionUpdater.ApplyActionItemAddedAsync` (`src/Api/Projections/ProjectionUpdater.cs:379`) raises `NoteNotFoundException` when `noteDetailStore.GetAsync` returns null. The note and the action are separate streams and DynamoDB Streams give no ordering between different keys, so when the action is added within about a second of the note, the action's record can arrive first. The throw fails the whole Lambda batch, so the stream retries it, and every other stream sharing that shard waits behind it.

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

**How it happens.** The Save button and the Cancel button occupy the same place in the note header, and which one is rendered depends on whether the note looks empty (`NoteView.tsx:710`, keyed off `hasContent`). For a brand-new note, Cancel does not merely go back — it deletes the note (`handleCancel`, `NoteView.tsx:685-693`). The note momentarily looks empty right after a successful rename: the displayed title is `titleDraft ?? detail?.title ?? initialTitle` (`NoteView.tsx:191`), the rename's success handler clears `titleDraft`, and the note-detail read that was already in flight when the rename happened comes back carrying the note as it was *before* the rename — with no title — and overwrites the cache the rename had patched (`useRenameNoteDetail`, `useNoteDetailMutations.ts:31-39`, which never cancels the in-flight query). For that window the header shows Cancel where Save was, and a click already on its way lands on Cancel.

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

**What is NOT directly observed:** the button swap itself. Confirming it means catching the control's identity at click time — record the `data-testid` actually hit, or assert no `DELETE /notes/{id}` fires during a save. That check does not exist yet and should come with the fix.

**Fix direction:** two independent problems, and both are worth closing. (1) A destructive action must never occupy the same position as a non-destructive one, and must never appear under a cursor already moving toward the other — keep Cancel and Save in fixed, distinct positions, and never let a note flip to "empty" while a rename is settling. (2) The rename must cancel the in-flight note-detail query (`qc.cancelQueries`) before patching the cache, or an older response will keep overwriting a newer local truth. The second is the narrower fix; the first is what stops the class.

## BUG-70 — "+ New Note" while recording leaves an orphan note behind

**Severity:** Medium — clutter, not loss, but the app creates something the user explicitly declined. **Status:** Open. Pre-existing since [BUG-54] added the guard; surfaced by [CHANGE-33] review.

**Symptom:** clicking "+ New Note" mid-recording creates a real, dated, empty note. Choosing "Keep recording" abandons the navigation but not the note, which then shows on the home list as an untitled blank card the user never made.

**Cause:** `handleNewNote` (`web/src/App.tsx`) creates the note **server-side first** — `createNote` → `setNoteDate` → optional `moveNote` — and only then calls `openNote`, which is where the [BUG-54] recording guard runs. CHANGE-33's new "Still recording — open the new note?" copy makes the promise explicit, and it correctly names a note that does exist.

**Fix direction:** ask before creating, not after — route the guard around the whole of `handleNewNote` (`requestLeave(() => void handleNewNote(), "open the new note")`) so a declined leave never reaches the create. Check `handleOpenNextOccurrence` and the `/ai` create-note path in `NoteView` for the same create-then-guard ordering. Frontend-only; no event, projection or endpoint change.

**Deliberately held until 51-C merges (2026-08-10).** 51-C removes the leave-prompt from `openNote`, and `handleNewNote` calls `openNote`. This bug's orphan exists **only** when the user declines that prompt — so if the prompt goes, the described mechanism may not survive, and wrapping `handleNewNote` in `requestLeave` would be either a no-op or something 51-C then has to neutralise. **This is a reason to sequence, not a diagnosis — nobody has verified it.** When 51-C lands, re-run the repro: if the orphan still appears it is a small fix on settled code; if it does not, close this row naming 51-C as what fixed it. Raised by the 51-C session, which carries the same interaction note from its side.

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
