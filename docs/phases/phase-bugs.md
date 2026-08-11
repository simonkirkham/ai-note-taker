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
| BUG-77 | You finish a recording and the note is never analysed. You are now told what actually stopped it — an expired sign-in, an unreachable server, a missing note — instead of one catch-all sentence, but why it happens at all is still unknown. | Open | TI-67, TI-78, BUG-33 |
| BUG-79 | Something you just created — an action item, or a note — can be missing after you reload, and stay missing. Rare, but this is the one guarantee the app is built to make. | Open | — |
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

**Confirmed defect — the mis-reporting. Fixed, PR #TBD.** `RecordControl.tsx:73` caught with a bare `catch {}` and discarded the error, so a dead network, an expired sign-in, a refused request and a parse error all printed one sentence that named the wrong subsystem and advised a retry that may have been incapable of working. Compounded by [TI-67] (RUM `CustomEvents: DISABLED` in prod), so nothing client-side was recorded either.

**What the fix changed:**

| Now | Detail |
|---|---|
| The message names the real failure | Expired sign-in → *sign in again*; unreachable server → *check your connection*; server fault → *temporarily unavailable*; missing note → *no longer exists*, with the retry advice dropped where a retry cannot work |
| Every failure emits `analyseFailed` to RUM | `kind`, `status`, `sent`, `elapsedMs`, `trigger` (the automatic post-recording analyse vs the button), `noteId`, `online`, truncated `detail`. Query in [observability.md](../observability.md#why-did-a-notes-analysis-fail) |
| A request that never left the browser is distinguishable from one the server refused | `apiFetch`'s synthetic pre-flight 401 now carries `x-client-not-sent`, surfaced as `ApiError.notSent` → `sent: false`. Both are 401 and neither reaches the gateway, so nothing else could tell them apart |

**The record can still be dropped, until [TI-78] lands.** The RUM client's default `sessionEventLimit` of 200 is not overridden, so custom events stop being sent late in a long session — which is exactly when a post-recording analyse happens. Treat an absent `analyseFailed` on a long session as unproven, not as evidence the failure did not occur.

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

## BUG-79 — A fresh write can stay unreadable after a reload

**Severity:** High (deploy-gate flake bar). **Status:** Open. Raised 2026-08-10 from E2E run [#164](https://github.com/simonkirkham/ai-note-taker/actions/runs/31406829746).

**Why it matters:** the failing journey exists specifically to prove read-your-writes on the deployed async projector — the guarantee that what you just did survives a reload. When it fails, the user's write appears lost.

**Symptom:** `ActionReadYourWritesJourney.Added_action_appears_after_reload` failed — add an action, reload, re-open the actions popover, and the action never appeared. The helper reloads in a loop for a full **30 s deadline**, re-sending the consistency token and re-gating each time, and still never saw it (33 s, then threw). This is not a lost 200 ms race. 29 of 30 journeys passed in the same run.

**Not attributable to any code change** — the only change in flight was `.github/workflows/e2e.yml` ([TI-69]); no `src/`, `web/` or `tests/` file moved.

**Frequency:**

| Where | Result |
|---|---|
| Deploy gate, actions | `scripts/flake-watch.sh 745 ActionReadYourWrites` — **10 clean of 10** across #745-#754, every attempt |
| Outside the gate, actions | 1 hit in 2 runs. The rerun ([#166](https://github.com/simonkirkham/ai-note-taker/actions/runs/31408911704), same filter) passed in **4 s** |
| Outside the gate, notes | 1 hit in 10 ([#169](https://github.com/simonkirkham/ai-note-taker/actions/runs/31414289871), peer session) |

It surfaced on the first run outside the deploy gate, which is also the first time the E2E suite has ever run outside it. A 4 s pass against a 33 s failure suggests the bad case is not a slow projector but a read that never gates at all.

**Not action-specific.** `OpenNoteTabsJourney.OpenTwoNotes_SwitchBetweenTabs_CloseOne` failed the same way on a just-created **note** that never reached the cards list inside 30 s. The shared symptom is a fresh write that never becomes readable.

**The good evidence:** the probe captured `injectedToken=note#8b7cdd87-…@5` present client-side, five `/notes/cards` reads all `200`, none flagged stale, and the card absent from a rendered list that did contain its sibling.

**Do NOT read that as "the read never gated."** `AppPage.cs:50-53` sets the label `none/fresh` when the header is *absent*, and its own comment says absent means **fresh-or-ungated**. The probe cannot currently tell those apart, so the gated-vs-ungated question is open; treating the label as proof would repeat [TI-69]'s mistake of inferring a cause from a signal that cannot carry it.

**Strongest lead, and it is testable:** the injected token is a **note-stream** token (`note#…@5`) while the failing read is the **card-list** projection, folded from a different key. The CLAUDE.md guardrail names this exact hazard — *DynamoDB Streams don't guarantee cross-key order, so gating a read on stream A's position while reading a projection built from stream B is a race.* A gate reporting caught-up on the note stream while the card fold lags produces precisely this: a fresh-looking 200 with the data missing, indefinitely.

**Next step:** make the probe distinguish gated from ungated — emit the request's outbound consistency token, not just the response header. Until then no cause can be confirmed.

**Diagnostic gap found alongside:** `AppPage.AssertActionVisibleAfterReloadAsync` swallows every `PlaywrightException` until the deadline, then lets the last one propagate bare — no page URL, no rendered state, no token value. That is the pattern [e2e-gate-hang-and-the-diagnostic-that-caused-it](../learnings/e2e-gate-hang-and-the-diagnostic-that-caused-it.md) says to replace with an evidence-carrying `throw`, and it is why this row cannot yet name the cause.

**Reproduce:** `gh workflow run e2e.yml -f runs=10 -f filter=ActionReadYourWritesJourney` — possible for the first time, per [TI-69].

---

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
