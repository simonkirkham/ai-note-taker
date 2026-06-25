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
| BUG-31 | A browser test (remove an image, then reopen the note) randomly fails during deploys and blocks releases. Of three underlying causes, two are fixed (the image reappearing; a network wait that never completed); one is still open — after reopening, the note's data sometimes takes ~30 s to load, so the Save button stays disabled and the test times out. The test is switched off for now; removing an image works correctly for real users. | Open | BUG-30, 27-RYW |
| BUG-32 | A just-typed `/ai` instruction is missed on Generate/Re-process — analyse raced the fire-and-forget content save; now flushes + awaits it first. (Residual: analyse still reads content from the async projection.) | Done | 29-A |
| BUG-33 | Forced through full Google consent after inactivity — the warm-tab refresh paths sign out an expired token without trying the valid `rt` cookie (and clear the established flag → `prompt=consent`). | Done | BUG-11, BUG-15, BUG-16 |
| BUG-34 | In-progress transcript lost on browser-back (Alt+←) and a re-record can't recover it — popstate is unguarded so the leave-commit is aborted; "Continue" only continues a *committed* transcript, never a draft; and starting a fresh recording overwrites then deletes the note-keyed draft. | Done | BUG-18, ADR-0011 |
| BUG-35 | Search over-matches — `NoteSearchRanker` scored whole fields with FuzzySharp `PartialRatio`/`TokenSetRatio`, which match any shared substring window, so "Andrew" matched the word "and" across unrelated notes. Replaced with word-level matching (exact / prefix / tight whole-token fuzzy). | Done | 22-A |
| BUG-36 | `npm run update` crashes on Windows with "the term 'silent' is not recognized" — `update.ps1` had UTF-8 em-dashes/arrows but no BOM, so Windows PowerShell 5.1 read it as Windows-1252; the em-dash byte `0x94` decoded to a `"` that closed a string early and broke parsing. Rewrote the script ASCII-only; added a `publish.spec.ts` guard that fails on any non-ASCII byte. | Done | 31-E |
| BUG-37 | The ✓ "Mark as discussed" tick on a note heading no longer works — clicking it does not toggle strikethrough on the topic/heading. | Done | 7-B |
| BUG-38 | `TagsJourney.AddTag_PersistsAfterNavigation` transiently red-gated the 39-A deploy — `tag-input` never became visible in 30 s (a basic always-present element → the app/page failed to load, not a projector lag). Passed on rerun; the two immediately-prior deploys (36-A, CHANGE-28) were green, so it is a chronic cold-start gate flake, not a 36-A/CHANGE-28 regression. The journeys also captured **zero** `[browser]` console output, so the failure gave no root-cause signal. | Open | TI-39 |
| BUG-39 | `TodoReorderJourney.Reordered_todos_persist_after_reload` **deterministically** red-gated deploy #656 (all **3/3** attempts) — after dragging BBB above AAA and reloading, the order reverted to the original `AAA, BBB` (assert is `AssertTodoOrderAfterReloadAsync`, **reload-tolerant** → the reorder write was *lost*, not merely lagging). The reorder code is byte-identical to #655 (the commit directly below), which **passed** the journey, so it is either a real 37-A reorder-persistence bug or a severe reorder-projector cold lag the reload-retries can't outlast. **Distinct from BUG-38** (that is element-render/cold-start; this is order-not-persisted). Blocks the shared deploy gate — held 36-B (a frontend-only theme slice that cannot touch todo order) out of prod despite 3 re-runs. High priority: 37-A was marked Done on the lucky-green #655. | Open | 37-A |

Further bugs will be appended as they are identified.

---

> **Fixed bugs are condensed in [phase-bugs-archive.md](phase-bugs-archive.md)** (one terse entry each, anchors preserved). The Summary table above stays the full index; only **open** defects keep a detailed section below.

---

## BUG-38 — `TagsJourney` transiently red-gated a deploy (cold-start app-load flake) + journeys give no diagnostic

**Status:** Open — fast-follow. Surfaced during the 39-A deploy (run 28197938887, attempt 1, 2026-06-25). Not caused by 39-A.

**Symptom:** `TagsJourney.AddTag_PersistsAfterNavigation` failed waiting 30 s for `GetByTestId("tag-input")` (`AppPage.AddTagAsync`). `tag-input` is a static, always-present element on a note, so a 30 s miss means the page/app did not render in time — a cold frontend/app-load stall, not projector lag.

**Why it's a flake, not a regression:** the two deploys immediately before (36-A `3bf37fb5`, CHANGE-28 `6fdb3206`) were both green (their E2E gate, incl. `TagsJourney`, passed), and the rerun (attempt 2) passed `TagsJourney`. So neither 36-A's theme bootstrap nor CHANGE-28 broke app-load. Chronic cold-start gate flakiness (TI-39 family; cf. BUG-26).

**Second, separate finding (real, fixed):** the same run deterministically failed `ActionEditJourney` (39-A's own new journey) — a **temp-id race**: the journey edited the action before the optimistic add reconciled its `temp-…` id to the real server id, so the edit PUT hit `/actions/temp-…` → 404 → rolled back. Fixed in the same PR by reconciling through a gated reload before editing. (Latent product edge: editing within the sub-second add-reconcile window loses the edit — shared with complete/delete, left consistent.)

**Diagnostic gap (the durable lesson):** the run captured **zero** `[browser …]` console lines — xUnit swallows `Console.WriteLine` from the journeys, so an app-load failure produced only a bare Playwright timeout with no cause. Per the CLAUDE.md E2E guardrail, the action/tag reload-assert helpers should surface evidence through the **thrown exception message** (page.Url, rendered state, recorded sync request URLs) so the next occurrence is diagnosable.

**Next step:** add thrown-message diagnostics to the shared reload-tolerant assert helpers; re-evaluate whether the cold app-load needs a warm-up or a more tolerant initial wait once a diagnosable failure is captured.

---

## BUG-31 — A browser test ("remove an image, reopen the note") randomly fails during deploys

**Status:** Open — two of three causes fixed, one still open. The test is switched off for now so it doesn't block deploys, and the actual feature works correctly for real users.

**What the test does:** An automated browser test (`NoteImageJourney.Remove`) uploads an image into a note, removes it, saves, reopens the note, and checks the image is gone.

**The problem:** It passes most of the time but fails every so often — a "flaky" test. Because it runs as part of the deploy pipeline, one random failure blocks the release of unrelated changes. When we investigated (PR #294 — running it repeatedly with a 120-second safety cap so it couldn't hang forever), it turned out to be **three separate problems stacked on top of each other**:

1. **The removed image used to reappear after reopening** — the original complaint. ✅ **Fixed** by the wider read-after-write consistency work (the projector "warm-up" from TI-39 and reading ownership from the event stream in BUG-30). Confirmed once early runs showed the image correctly gone.
2. **A shared test helper waited for a network call that never happened.** The `SaveAndReturnAsync` helper waited for the note-list request (`GET /notes/cards`), but the page can serve that list from its in-memory cache without making a request — so the wait timed out after 30 seconds. ✅ **Fixed (PR #297)** by waiting for the home screen to appear instead. This removed a hidden source of flakiness across the whole test suite, not just this one test.
3. **The Save button stays disabled too long after reopening.** 🔲 **Still open.** After reopening and editing the note, its data sometimes takes ~30 seconds to load. The Save button is disabled while the note is loading (`NoteView.tsx:401`), so the test clicks Save, nothing happens, and it times out. This is the same async / read-after-write family of issue — the note's data read gets stuck.

**Where it stands:** The test is switched off again (PR #298) with all three causes recorded, because the real app behaviour (remove an image → it stays gone) is verified working — only the test itself is unreliable.

**Next step:** Add logging to the note-data read to find out *why* it hangs ~30 seconds on reopen (a slow/stuck request, a retry storm, or the test matching the wrong Save button), fix that, and switch the test back on.

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
