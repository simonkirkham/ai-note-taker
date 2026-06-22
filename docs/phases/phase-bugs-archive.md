# Phase Bugs — Archive (fixed defects)

Condensed history of **fixed** bugs, moved out of [phase-bugs.md](phase-bugs.md) to keep the live doc to the Summary table + open defects. One terse entry per bug (symptom → root cause → fix); headings/anchors preserved so inbound `#bug-N` links resolve. Full per-bug detail (severity, evidence, repro, acceptance criteria, key files) is in git history and the linked PRs/learnings.

Live doc (the Summary table index + open bugs): [phase-bugs.md](phase-bugs.md). Table-only entries with no detail section (BUG-7 withdrawn, BUG-12, BUG-13, BUG-20) live in that table, not here.

---

## BUG-1 — Blank screen presented when 401 returned from API

✅ PR #99, 2026-06-02. Cold-load fetches went out before `AuthProvider`'s effect seeded the in-memory token → 401, which `apiFetch`'s `&& token` guard swallowed → blank screen. Fix: seed the token synchronously in the `useState` initialiser; on any 401, `apiFetch` does one deduped silent refresh-and-retry, else routes to sign-in.

## BUG-2 — favicon.ico request 404s / errors on every page load

✅ PR #103, 2026-06-02. No `<link rel="icon">` and no `favicon.ico` → the browser fell back to a 404'd `/favicon.ico`. Fix: added `web/public/favicon.svg` + an explicit icon link; an asset-assertion test guards it. _(The recurring `TopK`/`webgl` console warning is an injected browser extension, not this app.)_

## BUG-3 — ASP.NET Data Protection warnings on every Lambda cold start

✅ PR #108, 2026-06-02. Three Data Protection fallback warnings per cold start dominated the "All errors" widget. The API uses bearer tokens only (no cookie auth / antiforgery / `IDataProtector`), so Data Protection is genuinely unused → `Builder.cs` filters the category below Error (suppress-at-source).

## BUG-4 — `ConcurrencyException` surfaces as an unhandled 500 on note writes

✅ PR #107 (with BUG-5), 2026-06-02. Optimistic-concurrency conflicts on note writes had no handler/global mapping → 500. Fix: the global handler in `LoggingConfig` maps `ConcurrencyException` → 409 at one cross-cutting point. (Benign races were later also retried — BUG-17.)

## BUG-5 — Renaming a deleted/non-rebuildable note throws an unhandled 500

✅ PR #107 (with BUG-4), 2026-06-02. A pre-check read the eventually-consistent projection, then the domain guard threw a raw `InvalidOperationException` (uncaught) → 500. Fix: `NoteCommandHandler` rebuilds from the stream and throws typed `NoteNotFoundException` via a new `Note.Exists` predicate; the global handler maps that → 404, uniform across all note writes.

## BUG-6 — CloudWatch RUM receives no data (loader CDN host is regional)

✅ `hotfix/12-f-rum-cdn-host`. The RUM loader URL used `client.rum.eu-west-2.amazonaws.com` (NXDOMAIN) — the aws-rum-web loader CDN is global, served only from `us-east-1`; only the data-plane `endpoint` is regional. Fix: hard-code `us-east-1` for the loader host in both deploy jobs; keep `endpoint` regional. Not caught by any gate — a literal string that only fails at runtime DNS in a real browser.

## BUG-8 — `x-correlation-id` returned to clients is never emitted as a log field

✅ PR #125, 2026-06-02. The `x-correlation-id` header/body was set from `TraceIdentifier` but never appended to the Powertools logger → a user-quoted ID returned 0 results in logs. Fix: append it as the queryable `correlation_id` field on every log line. (The bearer token is still never logged.)

## BUG-9 — Note tab panels stack below Quick notes instead of replacing it

✅ PR #156, 2026-06-03. `.panel { display:flex }` beat the `hidden` attribute's UA default → inactive tab panels stayed laid out. Fix: `.panel[hidden] { display:none }`. jsdom doesn't apply CSS Modules so component tests passed blind → guarded by a real-browser `NoteTabsJourney` E2E. Lesson: CSS-driven visibility must be guarded at the browser layer.

## BUG-10 — Live transcription falls progressively behind realtime

✅ PR #158, deploy #445, 2026-06-03. The AudioWorklet posted ~8 ms (128-sample) chunks → ~125 SigV4-signed event-stream events/sec, more main-thread overhead than sustainable → an audio backlog that never drained. Fix: coalesce to ~100 ms PCM chunks (`PcmChunker`, ~10/sec) + throttle partial-result re-renders to ≤1/200 ms.

## BUG-11 — User is signed out too frequently

✅ PR #175, deploy #469, 2026-06-05. Sessions lasted ~1 h because the only refresh was a hidden-iframe `prompt=none` flow modern browsers block (third-party cookies); no refresh token was ever requested. Fix: a backend refresh-token flow — `access_type=offline`, refresh token in an `HttpOnly; SameSite=Strict; Path=/api/auth` `rt` cookie, `POST /auth/refresh` exchanges it; iframe deleted. The 30-day window slides on each refresh.

## BUG-14 — Pasting space-separated tags intermittently drops a pill

✅ PR #205, deploy #495, 2026-06-09. On a freshly-created note `patchTags` no-ops when the note isn't cached, the in-flight GET resolves tagless, and `onSettled` invalidated only `keys.tags` → the first of two concurrent tag adds was lost. Fix: invalidate `keys.note` only when the optimistic patch couldn't apply (`ctx.previous === undefined`). Misdiagnosed first as latency (a 15→45 s timeout bump disproved it — a pill that never renders in 45 s is missing, not slow).

## BUG-15 — Forced through full Google sign-in on cold load (refresh cookie unused at bootstrap)

✅ PR #209, deploy #500, 2026-06-10. Every refresh trigger was guarded on an already-present token, so a cold load (expired token discarded) never tried the `rt` cookie → session effectively ~1 h not 30 days. Fix: a one-shot cold-start `attemptSilentRefresh()` in `AuthProvider` (when no token + no OAuth `code`), behind an `authLoading` spinner so sign-in never flashes; preserves the BUG-1 token-before-first-fetch invariant. Lesson: audit every entry path that should consume a recovery mechanism, especially cold start.

## BUG-16 — Google emails the user on every login (`prompt=consent` forces a consent grant)

✅ PR #215, deploy #504, 2026-06-10. `prompt=consent` was hard-coded on every auth URL (added in BUG-11 to guarantee a refresh token) → a fresh consent grant + security email each sign-in. Fix: send `prompt=consent` only when a `google_refresh_established` localStorage flag is absent; set on any token acquisition, cleared on every refresh-failure path (incl. the 401 branch). The backend already never clobbers an on-file token with an empty one.

## BUG-17 — Concurrent multi-word tag add silently drops a tag (no handler retry on conflict)

✅ PR #217, deploy #506, 2026-06-10. BUG-4 mapped a conflict to 409 but never retried, so a benign same-stream race still lost the second tag (its phantom pill then 404'd on removal). Fix: a bounded retry (read→rebuild→handle→append, 4 attempts) on `ConcurrencyException` in `NoteCommandHandler`; `untagNote()` treats 404/409 as OK. Aggregate stays pure.

## BUG-18 — Removing an inline image (or any content edit) is silently not persisted

✅ PR #232, deploy #520, 2026-06-11. Content saved only on editor `onBlur`; the Save button navigated without flushing, and removing an image kept focus off the body → no blur → the draft was discarded (silent data loss). Fix: a ref-guarded `handleSaveContent` flushes on leave (Save/back) and unmount, restores on error; `deletingRef` skips the flush on delete. The 25-D E2E removed a never-persisted image (no-op PUT) so it shipped blind.

## BUG-19 — Inline image flashes a 403 on every open (raw key rendered before resolve)

✅ PR #232, deploy #520, 2026-06-11. `ImageNodeView` first painted the bare S3 key as `<img src>`, which the browser resolved relative to the SPA route (`/notes/notes/…` → 403) before `resolveImages` swapped in the presigned URL. Fix: render a placeholder span while `isImageKey(src)`. (This only suppressed the rendered node, not the parse-time fetch — see BUG-24.)

## BUG-21 — Note title silently lost when navigating in and out of a note

✅ PR #258, deploy #547, 2026-06-13. Title was seeded once from a prop (never reconciled with `detail.title`) so it could show empty; the auto-focused input's blur then persisted that empty value (`HandleRename` had no guard) → permanent loss in the stream. Fix: migrate title to the draft pattern (`titleDraft ?? detail?.title`); `handleSaveTitle` no-ops empty/whitespace/unchanged; domain `HandleRename` guards `IsNullOrWhiteSpace`. Write-up: [phase-bug21-note-title-draft-reconcile](../learnings/phase-bug21-note-title-draft-reconcile.md).

## BUG-22 — Multi-tag add drops a pill under RYW-2 async reads — consistency-token slot overwritten by an older version

✅ PR #262, deploy #551, 2026-06-13. Under RYW-2 async reads, two concurrent same-stream tag POSTs returned `@N`/`@N+1`; the per-stream token slot was last-writer-wins, so the older `@N` could win and the next gated read released before the second tag folded (the server never flags `stale`, so the retry loop couldn't rescue it). Fix: keep the **highest** version in the slot (`setStreamToken`/`setLatestToken` max-version, per-stream). Resolved the reopened [TI-19](../technical-improvements-archive.md#ti-19) `TagsJourney` flake (20/20 first try). Follow-up: tag-pill asserts made reload-tolerant.

## BUG-23 — Projection rebuild returns an unhandled 500 on a transient DynamoDB timeout

✅ PR #269, deploy #558, 2026-06-13. The rebuild's *writes* retried but the heavy *reads* (`ReadAllStreamsAsync`, reconcile scans) were unwrapped, so a transient `TimeoutException` aborted the whole rebuild → 500. Fix: a generic `BoundedWrites.WithRetryAsync<T>` wraps every rebuild read; a surviving timeout / non-client cancel maps to a retriable **503** at Warning (a genuine client abort still → 500).

## BUG-24 — Inline image 403s on every note open (parse-time fetch of the bare S3 key)

✅ PR #273 (v2), deploy #563, 2026-06-13. `tiptap-markdown` parsing built an `<img src="notes/…">` from the stored bare key and the browser fetched it (relative → 403) *before* any NodeView guard existed; BUG-19 only suppressed the rendered node. **v1 (PR #272) was merged then reverted** — a renderer-rule passed a unit seam but the real `setContent` parse bypassed it. v2 (resolve-before-parse): create the editor with `stripImageKeys(value)`, then `setContent` only presigned URLs once resolved. Lesson: a no-fetch property is unprovable in jsdom — only the deploy-gate E2E proves it.

## BUG-25 — `ActionItemJourney.Action_items_persist_across_navigation` E2E flakes under async-projector lag

✅ PR #275, deploy #565, 2026-06-13. RYW-3a made the actions read async/token-gated, but this pre-existing journey used a plain 5 s locator wait with no reload-tolerance → timed out under cold-projector lag. Fix: route the asserts through the reload-tolerant `AssertActionVisibleAfterReloadAsync`; removed the flaky plain helper. Test-only; the systemic pattern was BUG-26.

## BUG-26 — Deploy E2E gate intermittently red: post-navigation visibility asserts race the async projector

✅ Done 2026-06-13 via TI-39. The RYW async-projection migration made every post-navigation E2E assert depend on the deployed projector folding within the 5 s locator bound; journeys were hardened reactively (cards #256, tags #265) with no systematic guarantee. Closed by [TI-39](../technical-improvements-archive.md#ti-39)'s projector warm-up/drain + 15 s global timeout + reload-tolerant asserts/actions. Two real bugs surfaced en route ([BUG-27], [BUG-29]); residual concurrent-multi-tag race carved out as [BUG-28].

## BUG-27 — Concurrent multi-tag add silently drops a tag (exhausted-retry 409 treated as a duplicate no-op)

✅ Done (under TI-39). On retry exhaustion `NoteCommandHandler` rethrew `ConcurrencyException` → 409, which the client treats as a duplicate-tag no-op → the loser's write was silently dropped under a phantom optimistic pill. Aggravated by 27-D (separate Command-Lambda invocations). Fix: throw `WriteContentionException` on exhaustion → a retriable **503** (distinct from the duplicate 409); `MaxAppendAttempts` 4→6; client retries 503, throwing on the final attempt so a never-landing write rolls back. Lesson: a retriable failure must never share a status code the client treats as success.

## BUG-28 — Concurrent multi-tag add-then-remove drops a write (DynamoDB `TransactionConflict` escaped as an unhandled 500)

✅ Done. The loser of two concurrent `TransactWriteItems` on one stream's META row is cancelled with reason `TransactionConflict`, but `DynamoDbEventStore.AppendAsync` only translated `ConditionalCheckFailed` → `ConcurrencyException`, so the conflict escaped as an unhandled 500 and (not being `ConcurrencyException`) was never retried → silent drop. Not reproducible in-process (the in-memory store has no transaction-conflict semantics). Fix: classify `TransactionConflict` as a retriable `ConcurrencyException` too (extracted + unit-tested); protects every aggregate's concurrent writes.

## BUG-29 — Projector can't purge note images on delete (role missing `s3:ListBucket`)

✅ Done, 2026-06-13. The Projector role had `GrantDelete` (DeleteObject only) but `PurgeNoteAsync` **lists** objects first → every `NoteDeleted` purge threw `AccessDenied (s3:ListBucket)` (caught at Warning), orphaning images in S3 indefinitely. A 27-RYW/27-D IAM gap. Fix: add `imagesBucket.GrantRead(projectorFunction, "notes/*")` (ListBucket+GetObject) alongside GrantDelete; CDK assertion requires a List action (still no PutObject).

## BUG-30 — Note-scoped handlers authorized against the async NoteDetail projection → 404 after create under load

✅ Done. Every note-scoped handler checked ownership via the async `NoteDetail` projection then 404'd on null, so an op right after `POST /notes` hit a not-yet-built projection → a 404 storm under the E2E write burst (invisible in single-user prod; invisible to investigation because the E2E env is a separate AWS account). Fix: (a) writes authorize from the strongly-consistent **event stream** via a shared `INoteAuthorizer` in the Command Lambda; (b) the `GetActions` read (Query Lambda, no event-store access) keeps the projection but adds a bounded re-poll for the cross-stream fold race. Lesson: never authorize against an async projection.

## BUG-32 — A just-typed `/ai` instruction is missed on Generate/Re-process (Phase 29-A)

✅ Done, 2026-06-17. Content saved on blur as fire-and-forget; `handleGenerateFinalNotes` called `analyseM.mutateAsync()` without awaiting it → the analyse POST raced the content PUT and read the previously-saved content, dropping a just-typed `/ai` line. Fix: flush + await the in-flight content save (`pendingContentSaveRef`; `handleSaveContent` → `mutateAsync`) before analysing; regression test asserts PUT-before-POST. Residual: `AnalyseNote` still reads content from the async projection (deferred — projector keeps up for single-user prod).

## BUG-34 — In-progress transcript lost on browser-back; re-record couldn't recover it

✅ Done, 2026-06-22 (PR #306, deploy #606). Alt+← (popstate) while recording silently unmounted the note: `beforeunload` doesn't fire on SPA nav and the leave-confirm was wired only to the in-app Save button, so the fire-and-forget unmount commit was aborted on a true page exit → first recording never committed. Re-record couldn't recover it: "Continue" keyed only off the *committed* transcript (`hasInitialTranscript = transcriptText !== null`), so a fresh recording started empty and its commit deleted the note-keyed draft. Confirmed in prod (note `0a449915…`): only the *second* recording's `TranscriptionCompleted` (v41) existed; draft table empty. Fix: (a) popstate guard in `NoteView` (trap history entry → leave-confirm; "Leave & save" exits via `onExit` to a fresh route, not `navigate(-1)` which the trap absorbs) + a `pagehide` keepalive flush in `useTranscription` writing the finalised tail to the loss-tolerant **draft** (never a premature commit); (b) draft-aware Continue — `NoteView` feeds an interrupted draft into `RecordControl` so Record offers Continue seeded from it. Frontend-only; the popstate guard's full browser-history nav is unprovable in jsdom (`BrowserRouter`, no `useBlocker`), so data-safety rests on the unit-tested pagehide flush + unmount commit. See [learning](../learnings/phase-bug34-transcript-leave-guard.md).
