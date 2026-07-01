# Phase Bugs — Defect backlog

**Goal:** A standing, unnumbered phase that captures bugs found in the deployed app and tracks them to a fix. Unlike numbered phases, this has no learning theme and no fixed slice sequence — items are added as defects surface and removed (marked Done) as they are fixed. Each bug is still fixed the normal way: a failing spec/test that reproduces it first, then the fix.

**What belongs here:** defects — behaviour that is wrong, broken, or crashes. If it's a small adjustment to working behaviour it's a **minor change** ([docs/phases/phase-minor-changes.md](phase-minor-changes.md)); a new capability is a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase); a refactor/upgrade/CI item is a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** none specific — this is maintenance work. The discipline is reproduce-before-fix (the Prove-It pattern) and guarding against regression.

---

## Summary

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| BUG-1 | Blank screen presented when 401 returned from API | Done | — |
| BUG-2 | favicon.ico request 404s / errors on every page load | Done | — |
| BUG-3 | Data Protection warnings on every Lambda cold start (log noise) | Done | — |
| BUG-4 | ConcurrencyException surfaces as unhandled 500 on note writes | Done | — |
| BUG-5 | Renaming a deleted note throws unhandled 500 instead of 404 | Done | — |
| BUG-6 | CloudWatch RUM receives no data — loader CDN host is regional, doesn't resolve | Done | 12-F |
| BUG-7 | _Withdrawn — "empty notes created and left behind"; removed as not-a-defect (85eba79). Number retained, not reused._ | Withdrawn | — |
| BUG-8 | `x-correlation-id` returned to clients is never logged — a user-quoted ID can't be found in logs | Done | 12-A |
| BUG-9 | Note tab panels (Transcript/Final notes) stack below Quick notes instead of replacing it | Done | 15-B |
| BUG-10 | Live transcription falls behind realtime — audio streamed in ~8ms chunks (~125 events/sec) | Done | — |
| BUG-11 | Signed out ~hourly — iframe silent refresh fails under third-party-cookie blocking; switch to backend refresh-token flow | Done | — |
| BUG-12 | `DynamoDbNoteSearchViewStore.GetByNoteIdAsync` omits `ConsistentRead = true` — stale read on the inline read-modify-write can clobber a just-written field | Done | 22-A |
| BUG-13 | Search bar shows two clear `✕` — the native `<input type="search">` cancel button on top of the custom clear button | Done | 22-B |
| BUG-14 | Pasting space-separated tags drops a pill — optimistic patch no-ops when the note isn't cached yet (initial GET in flight) | Done | 20-E |
| BUG-15 | Forced through full Google sign-in on cold load — bootstrap never uses the `rt` refresh cookie, so the session is only ~1h not 30 days | Done | BUG-11 |
| BUG-16 | Google emails the user on every login — `prompt=consent` forces a fresh consent grant on each sign-in | Done | BUG-11 |
| BUG-17 | Concurrent multi-word tag add drops a tag — second append loses the optimistic-concurrency race and is silently dropped (no handler retry) | Done | BUG-4, BUG-14 |
| BUG-18 | Removing an inline image (or any edit) is silently not persisted — note content saves only on editor `onBlur`; the Save button navigates without flushing the draft | Done | 25-D |
| BUG-19 | Inline image flashes a 403 on every open — `ImageNodeView` renders the raw S3 key as a relative `<img src>` before `resolveImages` swaps in the presigned URL | Done | 25-B, 25-D |
| BUG-20 | Workspace-switcher popover overlaps the main content when open (widened in 23-E) — keep it within the sidebar width and reveal rename/delete on row hover so names still fit. | Done | 23-E |
| BUG-21 | Note title silently lost on navigate in/out — the title field is never reconciled with `detail.title` (no draft-pattern sync) so it can show empty, and a blur then persists that empty value. | Done | — |
| BUG-22 | Multi-tag add drops a pill under RYW-2 async reads — the per-stream consistency-token slot is last-writer-wins; the older `@N` can win and the next gated read releases before the second tag folds. | Done | TI-19, RYW-2 |
| BUG-23 | `POST /admin/projections/rebuild` returns an unhandled 500 when a DynamoDB call inside the rebuild times out — the whole rebuild aborts mid-flight with no retry. | Done | TI-16 |
| BUG-24 | Inline image 403s on every note open — `tiptap-markdown` parse-time fetch of the bare S3 key (relative to the SPA route) races before `ImageNodeView`'s guard exists. | Done | BUG-19, TI-37 |
| BUG-25 | `ActionItemJourney.Action_items_persist_across_navigation` E2E flakes under async-projector lag — a plain 5 s wait with no reload-tolerance. | Done | RYW-3a, BUG-26 |
| BUG-26 | Deploy E2E gate intermittently red — post-navigation visibility asserts race the async projector (systemic; fixed 2026-06-13 via TI-39 warm-up/drain + reload-tolerant asserts). | Done | RYW-2 |
| BUG-27 | Concurrent multi-tag add silently drops a tag — exhausted-retry contention returns 409 (treated as a duplicate no-op) instead of a retriable 503. | Done | RYW-2, BUG-17, BUG-26 |
| BUG-28 | Concurrent multi-tag add-then-remove drops a write — DynamoDB `TransactionConflict` escaped as an unhandled 500 (only `ConditionalCheckFailed` was retried), silently dropped. | Done | BUG-27, RYW-2, 27-D |
| BUG-29 | Projector can't purge note images on delete — role missing `s3:ListBucket`, orphaning deleted notes' images in S3 indefinitely. | Done | 27-D |
| BUG-30 | Note-scoped handlers authorized against the async NoteDetail projection → 404 right after create; auth moved to the strongly-consistent event stream (largest residual deploy-gate flake). | Done | 27-RYW, 27-D |
| BUG-31 | A browser test (remove an image, then reopen the note) randomly fails during deploys and blocks releases. Three stacked causes: two fixed; the third (after reopening, the note's data takes a long time to load → Save stays disabled → timeout) is the cold-projector RYW lag, now **mitigated in prod** (read gate 2s→8s, PR #377, deploy #681). Remaining: re-enable the test and verify. Removing an image works correctly for real users. | In Progress | BUG-30, 27-RYW |
| BUG-32 | A just-typed `/ai` instruction is missed on Generate/Re-process — analyse raced the fire-and-forget content save; now flushes + awaits it first. (Residual: analyse still reads content from the async projection.) | Done | 29-A |
| BUG-33 | Forced through full Google consent after inactivity — the warm-tab refresh paths sign out an expired token without trying the valid `rt` cookie (and clear the established flag → `prompt=consent`). | Done | BUG-11, BUG-15, BUG-16 |
| BUG-34 | In-progress transcript lost on browser-back (Alt+←) and a re-record can't recover it — popstate is unguarded so the leave-commit is aborted; "Continue" only continues a *committed* transcript, never a draft; and starting a fresh recording overwrites then deletes the note-keyed draft. | Done | BUG-18, ADR-0011 |
| BUG-35 | Search over-matches — `NoteSearchRanker` scored whole fields with FuzzySharp `PartialRatio`/`TokenSetRatio`, which match any shared substring window, so "Andrew" matched the word "and" across unrelated notes. Replaced with word-level matching (exact / prefix / tight whole-token fuzzy). | Done | 22-A |
| BUG-36 | `npm run update` crashes on Windows with "the term 'silent' is not recognized" — `update.ps1` had UTF-8 em-dashes/arrows but no BOM, so Windows PowerShell 5.1 read it as Windows-1252; the em-dash byte `0x94` decoded to a `"` that closed a string early and broke parsing. Rewrote the script ASCII-only; added a `publish.spec.ts` guard that fails on any non-ASCII byte. | Done | 31-E |
| BUG-37 | The ✓ "Mark as discussed" tick on a note heading no longer works — clicking it does not toggle strikethrough on the topic/heading. | Done | 7-B |
| BUG-38 | `TagsJourney` cold-start flake: `tag-input` never becomes visible in 30 s (a basic always-present element → the app/page failed to load, not projector lag). Hit `AddTag_PersistsAfterNavigation` on the 39-A deploy and `AddTag_PillAppearsOnNoteScreen` on deploy #666 (BUG-40) — both passed on rerun; surrounding deploys green, so a chronic cold-start gate flake, not a regression. Journeys capture **zero** `[browser]` console output, so the failure gives no root-cause signal. Diagnostics landed (#372, deploy #676): browser console + page-error capture, surfaced via the thrown message on a `tag-input` timeout. **Likely root cause [BUG-43]** — a cold SnapStart restore 500s the first read, so the note screen's reads fail and the UI never renders → `tag-input` never appears (the gate hits cold restores far more than warm prod). Flake itself stays open pending the BUG-43 fix. | Open | TI-39, BUG-43 |
| BUG-42 | `CreateAndListNoteJourney.Create_a_note_name_it_and_see_it_in_the_list` E2E flake — the post-create assert (the new note card visible in the list) races the async projector with a bare 15 s `ToBeVisible` and **no reload-tolerance**; failed deploy #667 attempt 1, passed on rerun. Same class as [BUG-25]/[BUG-26] (post-write visibility vs projector lag), not the BUG-38 cold-start app-load stall. Fixed (#371, deploy #673): both create→list asserts (`CreateAndListNoteJourney` + `NoteDeleteJourney`, the latter red-gated #672 the same way) now use the reload-tolerant `AssertNoteVisibleInListAfterReloadAsync`; the bare racy helper was removed. | Done | BUG-26 |
| BUG-43 | Query Lambda 500s on the first request after a SnapStart restore — the AWS SDK's cached credentials are captured in the snapshot and are stale on restore (`AmazonDynamoDBException: "The security token included in the request is invalid"`, `cold_start: true`). The priming hook registers `RegisterBeforeSnapshot` but no `RegisterAfterRestore`. 1× in 30 days (GET `/w/__default__/todos`), transient (next request succeeds). **Likely the common root of the cold-start E2E gate flakes ([BUG-38] etc.)** — a cold restore 500s the first reads, so pages don't load. **Correction (verified 2026-06-30, AWSSDK v4): the proposed `FallbackCredentialsFactory.Reset()` fix is likely ineffective** — that class is `[Obsolete]` in SDK v4 (clients resolve via `DefaultAWSCredentialsIdentityResolver`), so resetting it clears a cache the live clients no longer use; and it does not address the documented SnapStart root — under SnapStart the runtime serves *container* creds (`AWS_CONTAINER_CREDENTIALS_FULL_URI`) but the SDK cached the access-key *env-var* creds frozen in the snapshot. Real fix = stop the env-var provider winning over container creds after restore (or force re-resolution to container creds); must be verified against a real SnapStart restore, not just unit-tested. | Open | 27-D |
| BUG-41 | HTTP action-item endpoints have an object-level auth gap (IDOR) — `POST /notes/{noteId}/actions/{actionId}/complete\|reopen`, `PATCH …/edit`, `DELETE …` authorize the **route `noteId`** via `OwnsNoteAsync` but never bind it to the action: owning *any* note + knowing a foreign `actionId` lets you mutate that action (it stamps your `sub`). Gated by the unguessable random `actionId` (not enumerable — `get_actions`/`GetActionItems` filter to your own), so low exploitability, but it is broken object-level auth. Fix: authorize the action's own owner via the new `IActionItemAuthorizer.OwnsActionAsync` (added in 41-B for the MCP tools). Fixed (#370, deploy #674): the 4 mutation handlers authorize `OwnsActionAsync` (Command Lambda, event-stream read) instead of the route `noteId`; a foreign or deleted action returns 404 (the latter was 409). | Done | 41-B |
| BUG-40 | Blank lines a user adds for structure are stripped on save — note content is stored as markdown, whose serializer collapsed every run of consecutive blank lines / empty paragraphs to one, condensing the note. Fixed by a `BlankLineParagraph` extension that serializes a *non-trailing* empty paragraph as a U+00A0 line so the structure survives the markdown round-trip (#363, deploy #666 `70c87c4`). | Done | 25-D |
| BUG-39 | `TodoReorderJourney` reorder reverts after reload (deployed, deterministic 5/5). **Real root cause (test-env projector logs): `clear-test-data` wiped `notetaker-events` + projection tables but NOT `notetaker-proj-position`** → `Projector skip todo-order#__default__ at 1: position_guard`: the default workspace's stable-id order stream is reused every run; a prior run's processed-position (seq 1) survives the clear, so the next run's re-appended reorder (seq 1, events re-numbered from 0) is `≤` the stale mark and skipped as a duplicate → positions never applied. Stable-id streams collide; `note#`/`todo#<guid>` dodge it (fresh guids). **Not a product bug, not 36-B** (the 36-B correlation was coincidental — #655 first set the mark). Fix: `clear-test-data` now clears `proj-position` + all projection tables; journey **un-quarantined**. The per-item-`Position` fragilities the 37-A session noted (ConditionalCheckFailed swallow, PutItem clobber, cross-stream order) are real but latent — not the trigger here — tracked as an order-snapshot redesign follow-up (see detail). | Done | — |
| BUG-44 | Deleting a note races an in-flight content save → the note vanishes and the save 404s with a misleading "try again" that can never succeed (data loss). A calendar note was created, then a `DELETE` committed ~3 s before the debounced content `PUT` landed; the save hit the deleted note → 404 → *"Couldn't save your note. We kept your text — try again."* The kept text is unrecoverable (the note is gone). No delete confirmation/undo, and delete does not wait for a pending save. Confirmed in prod (2026-07-01 07:30 UTC, note `996cf435`). | Open | — |

Further bugs will be appended as they are identified.

---

> **Fixed bugs are condensed in [phase-bugs-archive.md](phase-bugs-archive.md)** (one terse entry each, anchors preserved). The Summary table above stays the full index; only **open** defects keep a detailed section below.

---

## BUG-44 — Delete races an in-flight content save → note vanishes, save 404s, text lost

**Status:** Open. **Severity:** High — silent data loss (user's typed content is destroyed and unrecoverable).

**Symptom (user report):** Created a note from a calendar meeting, edited it, hit Save → *"couldn't be saved"* error → the note then disappeared.

**Prod evidence (`--profile prod`, 2026-07-01, note `996cf435-5f6f-48e5-a03f-7c5a6082860f`):**
- Command Lambda: `07:30:11` `CreateNote`+`RenameNote`+`SetNoteDate`+`LinkNoteToCalendarEvent` (from-meeting); `07:30:30.879` `DeleteNote` handled → `NoteDeleted` v7; `07:30:33.802` `EditContent` received → `07:30:33.820` **`NoteNotFoundException` — Note … not found** (`CommandFailed`).
- Projector Lambda: `NoteDeleted` applied to `996cf435` v7.
- Browser RUM (session `1d17a697…`): `07:30:15 POST …/from-meeting 201` → user bounces note↔list ~5× in 20 s → `07:30:34 DELETE …/notes/996cf435 204` → `07:30:36 PUT …/notes/996cf435/content 404` (captured as an `http_event` error). The `PUT` is the save; it 404s because the `DELETE` already committed.

**Root cause:** two independent client actions on the same note are uncoordinated and raced.
1. **A `DELETE` was issued** for the note. No auto-delete/empty-draft-cleanup path exists in code — every delete is an explicit affordance: the trash button (`web/src/components/NoteView.tsx:543`) or the "Cancel" on a blank *new* note (`handleCancel`, `NoteView.tsx:434`, deletes when `isNew && !hasContent`). A calendar note always has a title, so `hasContent` is true (`NoteView.tsx:194`) and the **trash button** was the affordance shown. Easy to hit while rapidly navigating; no confirmation, no undo.
2. **The content save flushes on blur/navigate-away** (`handleSaveContent`, `NoteView.tsx:269`; unmount flush `:287`) and landed *after* the delete committed → 404. The failure handler keeps the draft and shows *"…We kept your text — try again."* (`:279`) — but retry is a dead end: the note no longer exists, so every retry 404s and the text is lost.

**Observable?** Partly — the `EditContent` failure logs at Warning (`NoteNotFoundException`, `CommandFailed` metric) on the Command Lambda, and RUM records the 404 `http_event`. Nothing links the delete and the failed save as a single incident.

**Fix directions (pick per priority):**
1. **Accidental-delete guard:** confirmation + undo on delete (at minimum when the note has content); consider not showing a destructive control on a just-created note until detail loads.
2. **Race / misleading-error fix:** block delete while a content save is pending (or cancel the pending save on delete), and map a save-against-a-deleted-note to a terminal *"this note was deleted"* message instead of the retriable "try again".

**Reproduce-before-fix:** an `Api.Integration`/frontend test where a note is deleted and a subsequent `EditContent`/`PUT …/content` for it returns the terminal outcome (not a retriable one), plus a component test that a delete does not fire while a content save is in flight.

---

## BUG-43 — Query Lambda 500 on first request after a SnapStart restore (stale SDK credentials)

**Status:** Open. **Severity:** Low — 1 occurrence in 30 days; transient (the next request after restore succeeds).

**Symptom:** A user-facing read returns **500**. Observed: `GET /w/__default__/todos` on a cold start.

**Prod evidence (`--profile prod`, Query Lambda log group):**
- `2026-06-22 20:07:36.963Z` — `level=Error`, logger `Api`, `cold_start: true`, fired immediately after a `RESTORE_START` (SnapStart restore) at `20:07:34`.
- `exception.type` = `Amazon.DynamoDBv2.AmazonDynamoDBException`, `exception.message` = `"The security token included in the request is invalid."`, `source` = `AWSSDK.Core`; stack originates in `Amazon.Runtime.Internal.HttpErrorResponseExceptionHandler`.
- `xray_trace_id` / `correlation_id` = `Root=1-6a399606-27e2fcb67b46077a6e89442f`.
- Count over 30 days (all five Lambda log groups): **1** match for the message, on this one path.

**Root cause:** SnapStart captures the snapshot at end-of-init. The AWS SDK credential chain is exercised during init (the `RegisterBeforeSnapshot` priming hook in `src/Api/Builder.cs:264` calls `IDynamoHealthCheck.CheckAsync` to warm it), so a security token is cached **in the snapshot**. On a later restore that token can be expired/invalid → the first DynamoDB call 500s. There is **no `RegisterAfterRestore` hook** to reset credentials after restore — only the before-snapshot priming hook exists (`Builder.cs:259–288`). Only the Query function uses SnapStart (`SnapStartConf.ON_PUBLISHED_VERSIONS`, `NoteTakerStack.cs:603`), which is why this is Query-only.

**Observable?** Yes — logged at Error and would trip `notetaker-error-rate` if it became frequent. Today it is too rare (1/30d) to breach the 1%-over-5-min threshold, so it is invisible at the alarm level but visible in logs.

**Fix direction:**
1. Register `Amazon.Lambda.Core.SnapshotRestore.RegisterAfterRestore(...)` alongside the existing before-snapshot hook, and in it reset the SDK credential cache (`Amazon.Runtime.FallbackCredentialsFactory.Reset()`) so the first post-restore request resolves fresh credentials. Lowest-risk, matches AWS SnapStart .NET guidance.
2. Alternatively, resolve credentials lazily per-request rather than warming/caching them before the snapshot.

**Reproduce-before-fix:** hard to reproduce on demand (needs a restore from a snapshot whose captured token has expired). Add a unit/integration assertion that an after-restore hook is registered, and verify in prod that the Error message stops recurring after the fix ships.

---

## BUG-41 — HTTP action-item endpoints: object-level auth gap (IDOR)

**Status:** Open. Found by Hawk during the 41-B review (the MCP equivalent was fixed in that slice; the HTTP surface was deliberately left to keep the slice tight).

**Severity:** Medium — broken object-level authorization, but practically gated: `actionId` is an unguessable random GUID and every action-listing endpoint filters to the caller's own items, so a foreign id is not enumerable through the API. Not a regression (the gap has always existed on the HTTP surface).

**Symptom:** A user who owns note `N1` can mutate an action item `A2` that belongs to another user's note `N2` by calling `POST /notes/N1/actions/A2/complete` (or `reopen`/`edit`/`delete`). The mutation lands and is stamped with the caller's `sub`.

**Root cause:** `ActionItemHandlers.{Complete,Reopen,Edit,Delete}ActionItem` authorize `noteAuthorizer.OwnsNoteAsync(routeNoteId, sub)` then call the command handler with **only** the `actionId`. `ActionItemCommandHandler.ExecuteAppendAsync` reads only the action stream — it never checks the action's recorded owning note (`ActionItemAdded.NoteId`) or stamped owner against the authorized note/user. So the route `noteId` is validated-but-unbound.

**Fix:** authorize the action's own owner via `IActionItemAuthorizer.OwnsActionAsync(actionId, sub)` (added in 41-B, `src/Api/Auth/ActionItemAuthorizer.cs`) in each of the four handlers — or assert the action's `ActionItemAdded.NoteId` equals the authorized route note. Reproduce-before-fix: an `Api.Integration` test where user A owns N1, user B owns N2+A2, and `POST /notes/N1/actions/A2/complete` with A's token currently succeeds (should 404).

**Key files:** `src/Api/Handlers/ActionItemHandlers.cs`, `src/Api/CommandHandlers/ActionItemCommandHandler.cs`, `src/Api/Auth/ActionItemAuthorizer.cs`.

---

## BUG-42 — `CreateAndListNoteJourney` E2E flake — post-create list assert races the projector

**Status:** Open. Hit on deploy #667 (41-B merge `ea96b55`) attempt 1; passed on rerun (`gh run rerun --failed`). Unrelated to 41-B's change (which touches only the MCP tools + action-item handler/authorizer, not the HTTP note-create or card-list path).

**Severity:** High (deploy-gate flake — a red shared gate blocks every slice; also skips `deploy-production`, so a slice reaches the test env but not prod until a rerun goes green).

**Symptom:** `CreateAndListNoteJourney.Create_a_note_name_it_and_see_it_in_the_list` fails: `Locator expected to be visible` — `GetByTestId("note-cards").Locator("[data-testid='note-card']").Filter(HasText = "Journey note …")` not visible within 15 s, no reload in the wait.

**Root cause (class):** since RYW the home card list (`GET /notes/cards`) is projector-built and eventually consistent. The journey creates a note then asserts the card is visible with a single 15 s `ToBeVisibleAsync` and **no reload** — a cold/lagging projector misses the window. Same class as [BUG-25]/[BUG-26] (post-write visibility vs projector lag), **not** the [BUG-38] cold-start `tag-input` app-load stall.

**Fix:** wrap the create→list assert in a reload-tolerant, re-gating wait (reload while not-yet-visible → free when warm), as the tag journeys do; confirm the deploy gate's projector warm/drain (TI-39) covers `NoteCardList`. Reproduce-before-fix is impractical (timing); the guard is the reload-tolerant assert.

**Key files:** `tests/Browser.E2E/Journeys/CreateAndListNoteJourney.cs:43`.

---

## BUG-40 — Blank lines a user adds for structure are stripped on save — FIXED

**Status:** **Done (2026-06-26).** Shipped in PR #363, deploy #666 (`70c87c4`, `deploy-production` success). Frontend-only.

**Symptom:** User types a note with blank lines between sections to make it readable. On save the blank lines disappeared and the content was condensed into a single tight block.

**Root cause:** Note content is persisted as **markdown**, serialized from the Tiptap doc by `ed.storage.markdown.getMarkdown()`. Markdown represents a paragraph break as exactly one blank line; it has **no representation for an empty paragraph or multiple consecutive blank lines**, so `tiptap-markdown`'s default serializer collapsed every run of them to one. The collapse happened client-side at serialize time — nothing downstream (API handler, `ContentEdited`, projection, DynamoDB) trims.

**Fix:** new `web/src/lib/blankLineParagraph.ts` — `BlankLineParagraph` replaces StarterKit's bundled Paragraph (`StarterKit.configure({ paragraph: false })` + the extension in `NoteEditor.tsx`). It serializes an **empty paragraph that is not the last child of its parent** as a single non-breaking-space (U+00A0) line. That line survives the markdown round-trip and reloads as a genuinely empty paragraph (no visible character); re-saving is idempotent. The *last-child* guard keeps the editor's auto-trailing caret paragraph and a fully-cleared note from persisting a stray U+00A0. Non-empty content is unchanged. Added `@tiptap/extension-paragraph@3.23.4` (exact-pinned to the StarterKit-transitive version, matching the `@tiptap/extension-image` pin, to dodge the tiptap ERESOLVE peer conflict).

**Tests:** `web/src/__tests__/blankLinePreservation.test.ts` (11 cases — single/multiple blank lines preserved, idempotent round-trip, reloaded blank line is empty, dense content untouched, heading/blockquote, cleared-doc → `''`, leading/trailing-blank, no stray placeholder after a list).

**Deferred (cosmetic):** a blank-line note's card preview can carry a literal U+00A0 (`MarkdownStripper` doesn't strip it). Harmless (downstream `IsNullOrWhiteSpace` treats U+00A0 as whitespace); left out to keep the fix frontend-only. File as a minor change if the preview gap is ever noticed.

---

## BUG-39 — Todo reorder reverts after reload (deployed only) — FIXED (test-data clear gap)

**Status:** **Done (2026-06-26).** Real root cause found in the test-env projector logs; fixed by clearing `notetaker-proj-position` in `clear-test-data`; journey **un-quarantined** (the `[E2EFact(Skip=…)]` removed). The 37-A session first filed + quarantined this to unblock the gate and hypothesised a per-item-`Position` redesign; the deployed trace shows the trigger was actually a **test-harness** gap, not the product.

**Real root cause (authoritative — from the test-env Projector Lambda log):**
`Projector skip todo-order#__default__ at 1: position_guard`. `clear-test-data` wiped `notetaker-events` + the projection tables but **not** `notetaker-proj-position` (the projector's per-stream processed-sequence store). The default workspace's order stream `todo-order#__default__` has a **stable id reused every run**. Once any run sets its processed-position to seq 1, every later run re-appends its reorder as seq 1 (the events table was cleared, so it re-numbers from 0), which is `≤` the stale mark → the projector's position guard **skips the reorder as an already-seen duplicate** → positions are never applied → `GET /todos` falls back to `AddedAt` order. Deterministic once the mark is set: #655 (the run that first set it) **passed**; #656 and its 4 reruns over 8 h all **failed** — so the #656/36-B correlation was coincidental (36-B is frontend-only and cannot touch todo order). Entity streams (`note#`/`todo#<guid>`) never collide because each run uses fresh guids; only **stable-id** streams (`todo-order#__default__`, and any default-workspace stream) do.

**Fix:** `clear-test-data` now also clears `notetaker-proj-position` plus the previously-omitted projection tables (`notesearchview`, `workspacelist`, `actionfeedback`, `tagfeedback`, `calendarlinkindex`) — a true clean slate, so a re-appended stable-id stream is re-processed from seq 0. `TodoReorderJourney` un-quarantined.

**Symptom:** drag BBB above AAA → reload → order reverts to `AAA, BBB`. The assert is reload-tolerant (30 s), so the reorder write is **lost**, not lagging. Deterministic: 3/3 on deploy #656 + 2 further reruns = **5/5**.

**Deployed-only — the in-memory double masks it.** `Api.Integration.TodoReorderTests` (`Reorder_PersistsTheNewOrder`, `Reorder_NewTodoAppendsAfterOrderedItems`) cover the exact scenario and **pass**, because the in-process `SyncProjectingEventStore` applies events synchronously in append order and `InMemoryTodoListStore` has no `attribute_exists`/PutItem semantics. So no test below the deploy-gate E2E can catch it — the documented "in-memory double hides the DynamoDB gap" guardrail.

**Latent follow-up (NOT the trigger here, but real — worth an order-snapshot redesign):** the per-item `Position` design is independently fragile. These did not cause BUG-39 (the deployed trace shows a whole-event `position_guard` skip, before any `SetPosition` runs), but are worth hardening:
- Order is stored as a `Position` int **on each `TodoItem` row**, set by `DynamoDbTodoListStore.SetPositionAsync` with `ConditionExpression = "attribute_exists(PK)"` — which **silently swallows `ConditionalCheckFailedException`** (a row not yet projected when the `todo-order#` reorder is processed → that item's position is **permanently dropped**; the comment's "the next reorder re-sends" never happens for a one-shot reorder).
- `DynamoDbTodoListStore.PutAsync` (the `TodoAdded` fold) is a **full `PutItem`** that only writes `Position` when non-null → any re-projection / out-of-order `todo#` fold after a reorder **clobbers** the position back to null.
- The `todo-order#` reorder stream and the `todo#`/`action#` item streams are **independent** (DynamoDB Streams give no cross-key order), so the projector can fold the reorder before/after the items in ways the synchronous in-process test never exercises.

**Optional hardening (order-snapshot, list-level — matches the `TodoOrdering` aggregate's own design comment):** store the full ordered id list on a **per-workspace ordering projection row** (keyed by `todo-order#{wsId}`), fold `TodoListReordered` into that single row, and order items in `GET /todos` by their index in the stored list (ids absent → end, by `AddedAt`). Immune to all three fragilities above. Replaces `Position`/`SetPositionAsync`/`UpdatePositionsAsync`. If pursued, add a DynamoDB-Local (`EventStore.Integration`) round-trip + a `ProjectorTests` cross-stream-order test. **Not required for BUG-39** (the test-data clear fix resolves it) — file as a `technical-improvements.md` item if the latent fragilities are deemed worth the rework.

**Un-quarantined** (2026-06-26): the `[E2EFact(Skip=…)]` on `TodoReorderJourney` is removed now that the clear-test-data fix lands; confirm green across the next couple of deploys.

---

## BUG-38 — `TagsJourney` transiently red-gated a deploy (cold-start app-load flake) + journeys give no diagnostic

**Status:** Open — fast-follow. Surfaced during the 39-A deploy (run 28197938887, attempt 1, 2026-06-25). Not caused by 39-A.

**Symptom:** `TagsJourney.AddTag_PersistsAfterNavigation` failed waiting 30 s for `GetByTestId("tag-input")` (`AppPage.AddTagAsync`). `tag-input` is a static, always-present element on a note, so a 30 s miss means the page/app did not render in time — a cold frontend/app-load stall, not projector lag.

**Why it's a flake, not a regression:** the two deploys immediately before (36-A `3bf37fb5`, CHANGE-28 `6fdb3206`) were both green (their E2E gate, incl. `TagsJourney`, passed), and the rerun (attempt 2) passed `TagsJourney`. So neither 36-A's theme bootstrap nor CHANGE-28 broke app-load. Chronic cold-start gate flakiness (TI-39 family; cf. BUG-26).

**Second, separate finding (real, fixed):** the same run deterministically failed `ActionEditJourney` (39-A's own new journey) — a **temp-id race**: the journey edited the action before the optimistic add reconciled its `temp-…` id to the real server id, so the edit PUT hit `/actions/temp-…` → 404 → rolled back. Fixed in the same PR by reconciling through a gated reload before editing. (Latent product edge: editing within the sub-second add-reconcile window loses the edit — shared with complete/delete, left consistent.)

**Diagnostic gap (the durable lesson):** the run captured **zero** `[browser …]` console lines — xUnit swallows `Console.WriteLine` from the journeys, so an app-load failure produced only a bare Playwright timeout with no cause. Per the CLAUDE.md E2E guardrail, the action/tag reload-assert helpers should surface evidence through the **thrown exception message** (page.Url, rendered state, recorded sync request URLs) so the next occurrence is diagnosable.

**Next step:** add thrown-message diagnostics to the shared reload-tolerant assert helpers; re-evaluate whether the cold app-load needs a warm-up or a more tolerant initial wait once a diagnosable failure is captured.

**Recurrence — 2026-06-26, deploy #666 (run 28254628800, attempt 1), BUG-40 merge `70c87c4`.** A **second** `TagsJourney` method now hits the same signature: `TagsJourney.AddTag_PillAppearsOnNoteScreen` failed `System.TimeoutException : Timeout 30000ms exceeded` waiting for `GetByTestId("tag-input")` (`AppPage.AddTagAsync`, `AppPage.cs:407`; `TagsJourney.cs:38`). 26/28 journeys passed (incl. other note-screen journeys that render `NoteEditor`), so not the BUG-40 frontend change — same chronic cold-start app-load stall on the always-present `tag-input`. Re-run via `gh run rerun 28254628800 --failed`. Confirms the flake is **not specific to one test method** — it is any first-note-screen `tag-input` wait on a cold app load. Still **zero** `[browser]` console output, reinforcing the diagnostic-gap next step. Both observed cases are `TagsJourney` because it is the first journey to open a note screen and type into `tag-input`.

---

## BUG-31 — A browser test ("remove an image, reopen the note") randomly fails during deploys

**Status:** In Progress — cause 3's **root cause is now mitigated in prod** (RYW gate cap 2s→8s, PR #377, deploy #681, 2026-07-01) so a real user's cold-projector read is tolerated instead of failing; two other causes already fixed. **Remaining:** re-enable the `NoteImageJourney.Remove` E2E test and verify it passes across deploys — the gate-cap fix caps the wait at 8s, so if the E2E env's cold projector genuinely exceeds that (the ~30s figure was measured there, not in prod) the test may still need the TI-52 keep-warm or an E2E-side reload-tolerant wait. The feature itself works correctly for real users.

**What the test does:** An automated browser test (`NoteImageJourney.Remove`) uploads an image into a note, removes it, saves, reopens the note, and checks the image is gone.

**The problem:** It passes most of the time but fails every so often — a "flaky" test. Because it runs as part of the deploy pipeline, one random failure blocks the release of unrelated changes. When we investigated (PR #294 — running it repeatedly with a 120-second safety cap so it couldn't hang forever), it turned out to be **three separate problems stacked on top of each other**:

1. **The removed image used to reappear after reopening** — the original complaint. ✅ **Fixed** by the wider read-after-write consistency work (the projector "warm-up" from TI-39 and reading ownership from the event stream in BUG-30). Confirmed once early runs showed the image correctly gone.
2. **A shared test helper waited for a network call that never happened.** The `SaveAndReturnAsync` helper waited for the note-list request (`GET /notes/cards`), but the page can serve that list from its in-memory cache without making a request — so the wait timed out after 30 seconds. ✅ **Fixed (PR #297)** by waiting for the home screen to appear instead. This removed a hidden source of flakiness across the whole test suite, not just this one test.
3. **The Save button stays disabled too long after reopening.** 🟡 **Root mitigated (PR #377, deploy #681).** After reopening and editing the note, its data sometimes takes a long time to load because the read waits on a cold projector. The Save button is disabled while the note is loading (`NoteView.tsx:401`), so the test clicks Save, nothing happens, and it times out. The 2026-06-30 obs-review confirmed this is the cold-projector RYW lag (see prod evidence below); the fix raises the read gate 2s→8s so the read now waits through a ~7s cold start instead of giving up. **Not yet verified end-to-end:** the test is still off; re-enabling it is the remaining step.

**Where it stands:** The test is switched off again (PR #298) with all three causes recorded, because the real app behaviour (remove an image → it stays gone) is verified working — only the test itself is unreliable.

**Next step:** Re-enable `NoteImageJourney.Remove` and watch it across a few deploys now that the read gate tolerates the cold start (8s). If it still flakes because the E2E env's cold projector exceeds 8s, either wrap the reopen assertion in a reload-tolerant/token-re-gating wait (the E2E convergence pattern) or pick up the projector keep-warm ([TI-52]). The new per-request caller-identity logging (PR #378) and the existing RYW `fresh/STALE/ABSENT` diagnostics make the reopen read's actual wait time observable if it recurs.

**Prod evidence (2026-06-30 observability-review) — the production manifestation of cause 3.** The `ConsistencyGate` (RYW) caps its wait at **2000 ms** (`src/Api/Consistency/ConsistencyGate.cs:24`) and then proceeds stale/absent. Over 14 days the gate timed out **11×**, all at the full `elapsedMs=2000` cap, in two shapes:
- Benign near-miss (`gap=1`, projector one version behind) — caught up moments later.
- The worst shape recurs ~weekly at **morning low-traffic hours** (06-17 08:36, 06-23 08:02, 06-26 09:37): `RYW gate STALE … reqVersion=3 lastSeq=-1 gap=4` immediately followed by `RYW presence gate ABSENT … elapsedMs=2000` for the **same** note. `lastSeq=-1` = the projector had recorded **no position at all** for that stream within budget — a **cold projector** (scaled-to-zero overnight) whose first-event start exceeds the 2 s RYW budget. The read then returns absent → a freshly-written note reads missing/stale on first load. This is the same cold-projector lag the test's ~30 s reopen hang exhibits. **Chosen fix (2026-06-30): raise the `ConsistencyGate` cap 2 s → 8 s** (`ConsistencyGate.cs:24`) so the reader tolerates a cold projector — a cold read becomes a one-off ~7 s slow-success instead of a 2 s failure; zero infra/recurring cost. Keeping the projector warm to make cold reads *fast* (scheduled ping ~$0/mo, or provisioned concurrency ~$5/mo) is deferred as [TI-52].

---
## BUG-33 — Forced through full Google consent after inactivity (warm-tab refresh skips the `rt` cookie)

**Status:** Done (2026-06-22) — fixed by **30-C** (both warm-tab paths now attempt a silent refresh against the `rt` cookie before signing out: `onVisibilityChange` collapses the `remaining <= 0` branch into the refresh attempt; `scheduleRefresh` runs an immediate refresh when `delay <= 0`) and **30-B** (the `google_refresh_established` flag forcing was removed entirely — sign-in never sends `prompt=consent`, so even a genuine sign-out no longer re-triggers the consent screen).

**Severity:** Medium — no data loss, but the user is repeatedly bounced through the full Google OAuth approval/consent flow during normal use (~twice a day, after stepping away), despite holding a valid 30-day refresh cookie. Same user-facing symptom as the supposedly-fixed [BUG-15]/[BUG-16].

**Symptom:** After a period of inactivity (tab backgrounded), returning to the app shows the Google sign-in **and the full scope-approval/consent screen** again, not a silently-restored session. Reported on Chrome/Edge, ~twice in one day.

**Root cause (confirmed):** Two warm-tab refresh paths treat an expired in-memory token as a dead session and sign the user out **without first attempting a silent refresh against the still-valid `rt` cookie**, and both clear `google_refresh_established` — which forces `prompt=consent` on the next sign-in:

1. `web/src/auth/AuthContext.tsx:117-119` — `onVisibilityChange`: `if (remaining <= 0) handleRefreshFailure()`. `handleRefreshFailure()` clears the token, sets `sessionExpired`, and calls `clearRefreshEstablished()`. It never calls `attemptSilentRefresh()`. Only the `remaining < REFRESH_LEAD_MS` (but `> 0`) branch tries the cookie.
2. `web/src/auth/useGoogleAuth.ts:42-45` — `scheduleRefresh`: `if (delay <= 0) { onRefreshFailure(); return }` — same anti-pattern when a token is (re)scheduled already at/after expiry.

Chrome throttles/freezes background-tab timers, so the proactive refresh scheduled `REFRESH_LEAD_MS` (5 min) before expiry does not fire while hidden; the ~1h id_token fully expires; on refocus `remaining <= 0` is the common case → path (1) fires. The 30-day `rt` cookie (and the 401-retry recovery in `api.ts`) would have restored the session, but the visibility handler pre-empts them by setting `sessionExpired` first. This is the warm-tab sibling [BUG-15] missed — that fix only added the **cold-load** bootstrap refresh.

**Evidence (prod, Command Lambda `oauth2.googleapis.com/token` calls, 2026-06-16/17):**
- Every Google `/token` call returns **200** — the refresh token is valid; Google never rejects it.
- A clean **~55-min** cadence of refreshes (id-token lifetime minus the 5-min lead) — the proactive timer works while the tab stays active.
- The user's sign-outs produce **no** failed/401 Google call — the failure path short-circuits **client-side** and never reaches `/auth/refresh`.

**Expected behaviour:** Returning to a backgrounded tab whose token expired silently restores the session from the `rt` cookie; the user reaches the Google approval flow only when the refresh token is genuinely absent/expired/revoked.

**Reproduce-before-fix:** add a red test in `web/src/__tests__/TokenRefresh.test.tsx`: tab becomes visible with an already-expired in-memory token but a refresh that **would** succeed → session is restored (currently ends signed-out with the flag cleared).

**Fix:** both paths attempt `attemptSilentRefresh()` first and only fail (and clear the flag) on a null result.
- `onVisibilityChange`: collapse `remaining <= 0` into the refresh branch — `if (remaining < REFRESH_LEAD_MS) { attemptSilentRefresh().then(t => t ? handleRefreshSuccess(t) : handleRefreshFailure()).catch(handleRefreshFailure) }`.
- `scheduleRefresh`: when `delay <= 0`, run a silent refresh immediately (adopt on success, `onRefreshFailure()` on null) instead of failing outright.

**Key files:** `web/src/auth/AuthContext.tsx` (visibility handler), `web/src/auth/useGoogleAuth.ts` (`scheduleRefresh`); tests `web/src/__tests__/TokenRefresh.test.tsx`. Related: [BUG-11] (refresh-token flow), [BUG-15] (cold-start bootstrap refresh), [BUG-16] (per-login consent).

**Tracking:** this frontend fix is scheduled as **slice 30-C** in [Phase 30 — Durable sign-in](phase-30.md). It is the immediate symptom-reducer; the *proper* fix for the re-authorise complaint (a server-side refresh-token store so the consent screen is shown once, ever) is the rest of Phase 30 (30-A/B/D). Empirically confirmed during diagnosis: the OAuth app is **Published** (the calendar refresh token has worked 15 days, past the 7-day Testing-mode expiry), so token expiry is not a contributing factor.
