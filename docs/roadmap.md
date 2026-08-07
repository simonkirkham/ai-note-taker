# Roadmap

This is the index for all planned and in-progress work. Each numbered phase below has a one-paragraph summary here and a detail doc under `docs/phases/`. Work that isn't a numbered phase — bugs, minor tweaks, model/prompt improvements, future feature ideas, and technical improvements — lives in the standing docs linked from [Standing tracks and planning docs](#standing-tracks-and-planning-docs) at the bottom.

Sequence is learning-optimised: event sourcing plumbing lands in Phase 1 so every subsequent feature is an ES learning moment, not a feature grind.

## Phase 0 — Setup _(Done)_

**Goal:** every tool is wired up, hello world deployed end-to-end, first spec passes.

Slices and acceptance criteria: [docs/phases/phase-0.md](phases/phase-0.md)

## Phase 1 — Walking skeleton with event sourcing _(Done)_

One `Note` aggregate (`NoteCreated`/`NoteRenamed`), append-with-optimistic-concurrency on DynamoDB (`TransactWriteItems` + META row), one `NoteTitleList` projection, and a React/S3/CloudFront frontend — create and list notes end-to-end.

**Goal:** event sourcing plumbing works end-to-end and is covered by event-model-driven specs.

Slices and acceptance criteria: [docs/phases/phase-1.md](phases/phase-1.md)

## Phase 1.5 - Testing Foundation — Layers 2–5 _(Done)_

Implement the remaining test layers from [ADR 0008](adr/0008-testing-strategy.md). Layer 1 (domain BDD specs) is already in place; this phase adds the other four.

- **Layer 2** — `tests/EventStore.Integration/`: spin up DynamoDB Local via Testcontainers; cover append + read, OCC conflict, empty stream, multi-event batch, schema correctness
- **Layer 3** — `tests/Api.Integration/`: in-process `WebApplicationFactory` tests; cover all endpoints, status codes, response shapes, error-to-status mapping
- **Layer 4** — `tests/Api.Smoke/`: harden existing suite (self-contained arrange per fact, remove cross-test ordering dependencies)
- **Layer 5** — `tests/Infrastructure.Assertions/`: CDK template assertions; cover Lambda env vars, IAM grants, DynamoDB deletion policies, CloudFront SPA routing

**Goal:** every PR is fully validated without an AWS account; the acceptance suite becomes a thin post-deploy smoke check.

## Phase 2 — Richer note lifecycle _(Done)_

Adds `NoteDeleted`, the first event-versioning change, and projection rebuild — event versioning learned by needing it.

**Goal:** you've changed your mind about an event's shape at least once and survived.

Slices and acceptance criteria: [docs/phases/phase-2.md](phases/phase-2.md)

## Phase 3 — Cross-aggregate projection (todo list) _(Done)_

`ActionItem` events (`Added`/`Completed`/`Reopened`/`Deleted`) and a projection that aggregates action items across all notes into one todo list; complete and delete todos from the home screen.

**Goal:** the "power of projections" moment — same events, new read model.

Slices and acceptance criteria: [docs/phases/phase-3.md](phases/phase-3.md)

## Phase 4 — UX redesign (wireframe alignment) _(Done)_

Bring the app in line with the wireframes in `docs/wireframes/`.

Settable note date (`NoteDateSet`), two-column note layout, implicit action add, persistent note-list sidebar, note summary cards (new `NoteCard` projection), and expandable completed todos.

**Goal:** the app matches the design intent; projection evolution is demonstrated by `NoteCard` aggregating across multiple event types.

Slices and acceptance criteria: [docs/phases/phase-4.md](phases/phase-4.md)

## Phase 5 — Tags and folders _(Done)_

Free-text tags (pills + a `TagIndex` filter bar with AND/OR multi-select) and a full `Folder` aggregate with hierarchy (create/rename/delete/reparent/cascade), a `FolderTree` projection, drag-between-folders, an Unfiled view, and a preview panel — replacing the prototype's `localStorage` state with real API calls.

**Goal:** second projection axis (`TagIndex`) alongside an entirely new aggregate (`Folder`); client-side filter state wired to a server projection; hierarchical read models.

Slices and acceptance criteria: [docs/phases/phase-5.md](phases/phase-5.md)

## Phase 6 — Upgrade to .NET 10 _(Done)_

LTS .NET 8 → 10 upgrade across all 10 projects (package-compatibility audit, Lambda runtime constant, SnapStart enabled), verified by the full test suite + E2E.

**Goal:** stay on a supported Lambda runtime; learn the .NET release cadence, AWS Lambda managed runtime lifecycle, and how to run a framework upgrade safely behind a full test suite. SnapStart teaches the Lambda version/alias deployment model and how AWS eliminates cold starts via execution environment snapshots.

Slices and acceptance criteria: [docs/phases/phase-6.md](phases/phase-6.md)

## Phase 6.5 — Frontend Component Tests _(Done)_

Scaffold Vitest + React Testing Library + MSW (testing Layer 7), rename the six test projects to scope-descriptive names, and write component tests for every home + note-view behaviour, trimming Browser.E2E to exactly 5 kept journeys.

**Goal:** replace slow Playwright tests as the primary UI regression net with fast, deterministic component tests; learn Vitest, RTL, MSW, and where in the pyramid each test layer earns its cost.

Slices and acceptance criteria: [docs/phases/phase-6.5.md](phases/phase-6.5.md)

## Phase 7 — Rich note content _(Done)_

Replace the plain textarea with a TipTap WYSIWYG editor (headings, bold, lists, checkboxes; heading-as-discussion-topic strikethrough); content stored as markdown in the existing `ContentEditedV2` event — no new events.

**Goal:** learn how to integrate a ProseMirror-based editor into a React frontend; understand markdown as a storage format and the tradeoffs of serialising structured editor state to plain text.

Slices and acceptance criteria: [docs/phases/phase-7.md](phases/phase-7.md)

## Phase 7.5 — Folder UX fixes and Lambda performance _(Done)_

Folder-UX fixes (remove the vestigial sidebar list, Unfiled preview pull-out, fix stale preview state, optimistic create/rename, heading sync) plus Lambda memory 128 → 512 MB to eliminate 10+ s warm latency.

**Goal:** close the gap between the Phase 5 spec and its implementation; learn that optimistic UI and prop-threading decisions that aren't paired with component tests at time of writing will silently regress. Demonstrate that Lambda memory is the primary warm-latency lever once cold starts are solved by SnapStart.

Slices and acceptance criteria: [docs/phases/phase-7.5.md](phases/phase-7.5.md)

## Phase 7.8 — Production Pipeline and Note Screen UX _(Done)_

A production deployment pipeline (`deploy-production` auto-promotes after Test; smoke-only against prod) plus note-screen UX hardening — keyboard focus, Save/Cancel lifecycle, drag-and-drop filing, a layout space review, and lifted optimistic card state.

**Goal:** Ship a production deployment target and harden the note-screen interaction model with explicit lifecycle controls, keyboard-first focus, and drag-and-drop note filing.

Slices and acceptance criteria: [docs/phases/phase-7.8.md](phases/phase-7.8.md)

## Phase 8 — Google Sign-In (multi-user auth) _(Done)_

Google Sign-In (PKCE, in-memory ID token) + JWT Bearer verification (Google OIDC); an `ICurrentUser` abstraction whose `sub` claim replaces the hardcoded user ID and first populates `EventMetadata.UserId`.

**Goal:** real authentication before Calendar integration arrives; learn Google OIDC, JWT Bearer middleware, PKCE, and multi-user data isolation while the system is still small enough to retrofit cleanly.

Slices and acceptance criteria: [docs/phases/phase-8.md](phases/phase-8.md)

## Phase 9 — Google Calendar integration + meeting notes _(Done)_

Today's meetings on the home screen (Google Calendar pass-through), one-click note creation linked to an event (`NoteLinkedToCalendarEvent`), meeting-time browser reminders, recurring-occurrence support, and a `CalendarLinkIndex` projection keyed by external event ID.

**Goal:** first outbound HTTP from Lambda; Google OAuth2 refresh-token flow; SSM Parameter Store for secrets; extending an aggregate with a new event without touching the immutable original; a projection keyed by an external system ID.

Slices and acceptance criteria: [docs/phases/phase-9.md](phases/phase-9.md)

## Phase 10 — Transcription & high-quality analysis _(Done)_

Build a high-quality AI analysis of meeting notes — and the means to keep it high quality: better input, measurement, and a durable correction signal that feeds prompt/model refinement. Slices 10-I → 10-M were absorbed from the former Phase 13 ("Feedback capture for AI suggestions") so that building, measuring, and refining analysis quality live in one phase.

Core flow: record audio (Transcribe Streaming via STS creds) → `TranscriptionCompleted` → Bedrock (Opus 4.6, `analysis@v9`) gap-fills content/tags/actions; auto-analyse on stop; the 10-G offline eval harness (versioned `PromptCatalog` + LLM-as-judge, nightly `eval.yml`); and additive `TagsSuggested`/`ActionItemsSuggested` feedback projections stamped with model/prompt version.

The feedback track (10-I → 10-L) is complete: the correction signal is durable, queryable, and rebuildable. 10-G shipped the eval harness + versioned prompts; 10-N moved the analyse path to the model-agnostic Bedrock **Converse** API, so any accessible model can be evaluated/run; 10-M stamps `modelId`/`promptVersion` onto the `*Suggested` events; 10-O shipped `analysis@v3` as the production prompt. All 15 slices (10-A → 10-O) are done.

**Goal:** first real-time streaming feature; first LLM integration; STS AssumeRole delegation; offline LLM evaluation; purely additive provenance events and projections that *classify by combining* events; event versioning to stamp prompt/model. The event model stays clean — analysis output reuses existing event types, so the domain never knows whether content came from a human or a model; the `*Suggested` events record AI provenance without mutating state.

Slices and acceptance criteria: [docs/phases/phase-10.md](phases/phase-10.md)

## Phase 11 — UI Polish _(Done)_

Tag autocomplete, home-screen quick-add todos (standalone todo aggregate), an adaptive note action bar + delete-blank-on-cancel, token expiry/silent refresh with a tab-wake 401 fix, and delete-from-home. Pure-frontend; no new aggregates.

**Goal:** Make everyday interactions feel faster and more intentional. Pure-frontend slices with no new aggregates.

Slices and acceptance criteria: [docs/phases/phase-11.md](phases/phase-11.md)

## Phase 12 — Observability _(Done)_

Make the app properly observable for production using AWS-native tooling only. Today there is one Lambda log group with unstructured text logs and nothing else — no correlation IDs, metrics, traces, dashboards, alarms, or frontend visibility. This phase closes every gap, pillar by pillar.

Structured logging + correlation IDs (12-A), EMF domain metrics (12-B), X-Ray tracing (12-C), the `notetaker-ops` dashboard (12-D), alarms + SNS email (12-E), CloudWatch RUM (12-F), an observability runbook (12-G), and a unified frontend+backend error view (12-H).

**Status:** Done — all eight slices shipped (12-A → 12-H). One follow-up remains: 12-E's concurrency-conflict alarm is deferred (CloudWatch rejects `SEARCH` on metric alarms — needs an alarmable dimensionless metric). (BUG-8 — `x-correlation-id` not emitted as a log field — was the other follow-up and is now fixed.) Optional post-deploy check: confirm the 12-H `AWS/RUM` metric widget populates (else add `CfnMetricsDestination`).

**Goal:** answer "is it healthy?", "what broke?", and "why is it slow?" from one place; learn the three pillars of observability and how they correlate, AWS Lambda Powertools, EMF metrics, X-Ray service maps, CloudWatch dashboards/alarms as CDK, and CloudWatch RUM. Driven by the `observability` skill.

Slices and acceptance criteria: [docs/phases/phase-12.md](phases/phase-12.md)

*(The former Phase 13 — "Feedback capture for AI suggestions" — was absorbed into Phase 10 as slices 10-I → 10-M.)*

## Phase 14 — Frontend standards alignment — CSS Modules migration & tooling _(Done — jsx-a11y deferred)_

Bring the `web/` frontend in line with the rewritten frontend standards (the `frontend-react` skill + `docs/react-coding-standards.md`). A pure refactor — no new behaviour, no backend, no event-model change — that retires the single 2,816-line global `App.css` for co-located CSS Modules, extracts design tokens and a new `--space-*` scale into `styles/tokens.css` + `styles/global.css`, and adds the tooling the standards now mandate (`clsx`, `@/` path alias, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`), an error boundary, a reusable inline-error/toast primitive, and a server-state-strategy ADR. 23 slices: a foundation slice, a pattern-setter, ~14 per-component module migrations ending with `App.css`'s deletion, four tooling slices, plus the error boundary, toast, and ADR. Regression-gated by the existing Vitest/RTL suite and Playwright E2E journeys; no visual change intended. Graduates the "Migrate App.css to CSS Modules", "Adopt jsx-a11y + import + `@/` alias", and "Decide on a server-state library" items from `docs/technical-improvements.md`.

**Goal:** retire a 2,816-line global stylesheet for scoped CSS Modules without changing a pixel; learn CSS Modules scoping, design-token/spacing systems, safe large-scale incremental refactoring under a regression net, ESLint flat-config plugins, path aliases, error boundaries, and ADRs.

**Outcome:** `App.css` deleted; all components on co-located CSS Modules; `@/` alias + import ordering (`eslint-plugin-import-x`) enforced; error boundary, toast primitive, and server-state ADR landed. **14-O dropped** (Phase 15-B deleted TranscriptionPanel); **14-S/14-T (jsx-a11y) deferred** — no ESLint 10 support yet (tracked in technical-improvements). One pipeline incident (E2E selecting on a hashed CSS class) fixed by moving E2E to `data-testid`.

Slices and acceptance criteria: [docs/phases/phase-14.md](phases/phase-14.md)

## Phase 15 — Split the note into Transcript, Quick notes & Final notes _(Done)_

Stop conflating what the user wrote with what the AI generated. Today a single `content` field holds both, and analysis with `updateContent` overwrites the user's notes with AI gap-fill. This phase splits the note screen into three labelled views — **Transcript** (raw speech-to-text, already stored), **Quick notes** (what the user typed; the AI never touches it again), and **Final notes** (a new durable, structured AI artifact: Summary, Discussion, Decisions, Action items, attributed to the model that wrote it) — matching the Transcript / Quick notes / Final notes tab model in the reference design. The core behavioural change: AI analysis stops mutating the user's notes and instead records a first-class `AnalysisSummaryRecorded` event. Sliced by user value, not by layer: a throwaway prototype validates the tab UX first; **15-A** delivers the headline fix — running analysis produces a separate, model-attributed Final notes artifact (Summary, Discussion, Decisions, Action items) and never overwrites the user's typed notes; **15-B** promotes the three views into the polished Transcript / Quick notes / Final notes tabbed reading experience; **15-C** adds on-demand "Re-process" regeneration. Forward-only — existing notes keep their already-merged content as Quick notes (no migration).

**Goal:** the first event that is a pure snapshot of AI output as a first-class artifact (a deliberate contrast with Phase 10, where analysis reused existing events to stay authorship-agnostic); evolving an LLM prompt to structured multi-section output while keeping the 10-G eval harness green; surfacing user-vs-AI provenance in a tabbed read view; and making a forward-only data-model change deliberately.

Slices and acceptance criteria: [docs/phases/phase-15.md](phases/phase-15.md)

## Phase 16 — Browse meetings by date on the home screen _(Done)_

The home-screen meetings section only ever shows *today's* meetings — `GET /calendar/today` and the Google Calendar client are both hard-wired to "now". This phase makes it **date-navigable**: previous/next-day buttons, a date picker hidden behind a button, and a heading that reflects the selected day (`Today's Meetings` / `Tomorrow's Meetings` / `Yesterday's Meetings` / `Meetings — Mon, 8 Jun`). A single vertical slice (16-A) generalises the today-only read path — the calendar client windows any day, and the misnamed `/calendar/today` route is replaced by a date-addressed `GET /calendar/{date}?tz=` (ISO date) — and adds the navigation UI, while deliberately decoupling meeting *reminders*, which stay pinned to the real today, from whatever day is being *browsed*. Navigation is unbounded. Builds on Phase 9.

**Goal:** generalise a time-bounded external-API read from `UtcNow` to an explicit local day; replace a misnamed action route with a date-addressed REST resource; nail the client/server timezone-boundary contract (client owns "which day", server owns the window); and split frontend state so the displayed data and a side-effect source (reminders) are driven by two different fetches.

Slices and acceptance criteria: [docs/phases/phase-16.md](phases/phase-16.md)

## Phase 17 — Link an existing note to a meeting after the fact _(Done)_

1. **Goal:** rebuild a read projection and add the frontend UI to link an existing note to a meeting after the fact.
2. **Backend already exists, unused by the UI:** the `LinkNoteToCalendarEvent` command, the `POST /notes/{noteId}/calendar-link` endpoint, and the `CalendarLinkIndex` projection.
3. **17-A (read-side):** `CalendarLinkView` gains `CalendarEventTitle` + `EndTime`; `GetNote` returns a `linkedMeeting` object; a projection rebuild backfills every meeting-created note.
4. **17-B (write-side):** an unlinked note gets a **Link to meeting** control that opens the Phase 16 date-navigable meeting picker; selecting a meeting calls the existing endpoint.
5. **Constraints:** link-once only (the server rejects a second link with `409`); no unlink/relink; optimistic badge display.
6. **Dependencies:** 17-B depends on 17-A; both build on Phase 9 (linkage model) and Phase 16 (date-navigable meetings).

Slices and acceptance criteria: [docs/phases/phase-17.md](phases/phase-17.md)

## Phase 18 — Crash-safe transcription: draft autosave & recovery _(Done)_

A live transcript is persisted only at terminal points (Stop / natural end), so a crash, tab close, or navigation mid-call loses everything captured so far. A shipped stopgap added an unmount flush plus a 15s autosave, but that autosave re-POSTs `TranscriptionCompleted` every ~15s — bloating a snapshot-less event log that replays the full stream on every command ([ADR 0011](adr/0011-transcription-checkpoints-draft-store.md)). This phase implements the correct design: interim checkpoints go to an **overwrite-in-place draft store** (not the event log); the log records exactly **one `TranscriptionCompleted` per recording** on a clean stop; and an interrupted recording is **recoverable** via a Recover / Discard banner on reopen. **18-A** adds the DynamoDB draft store, the no-event `PUT`/`DELETE .../transcription/draft` endpoints, draft deletion on commit, and a read-time `transcriptDraft` on `GET /notes/{id}`. **18-B** retargets the frontend autosave from the event to the draft, keeps clean exits committing once, and adds the recovery banner (folding in the stopgap's leave-warning + recording-counts-as-content fixes). 18-B depends on 18-A. **18-C** adds *continue a transcript*: pressing Record on a note that already has a transcript prompts **Continue** (append the new session after a `— resumed —` separator) or **Re-record** (replace) — frontend-only, reusing `TranscriptionCompleted` (latest-wins) with no new event, and the 18-A/18-B draft store carries the concatenation unchanged. 18-C depends on 18-A + 18-B. Builds on Phase 10.

**Goal:** the "not everything is an event" lesson — a deliberately non-event-sourced, loss-tolerant working-state store beside the log, motivated by the snapshot-less full-stream-replay cost; an idempotent overwrite (`PUT`) endpoint contrasted with the event-emitting `POST`; composing a read-time view (projection + draft) without polluting a rebuildable projection; DynamoDB TTL for self-cleaning ephemeral data; and a recovery UX for interrupted sessions.

Slices and acceptance criteria: [docs/phases/phase-18.md](phases/phase-18.md)

## Phase 19 — Frontend hardening _(Done)_

Close the gap between the `frontend-react` skill rules (extended in PR #173) and the actual `web/` code, and adopt the lint/compiler gates that would catch regressions automatically. A full audit on 2026-06-05 confirms the codebase is already clean on the headline rules — **0 `enum`, 0 `any`, 0 in-place state mutation, no active fetch races, no XSS sinks** — so this is hardening and consistency, not bug-fixing. Anchored by **19-A** (split the 408-line, 8-domain `api.ts` into per-domain modules behind a `request<T>()` helper, no barrel; behaviour unchanged), then typed-lint + non-null/catch cleanup (19-B), context-provider memoization (19-D), effect hygiene (19-E), accessibility — live regions + focus + jsx-a11y gate (19-F1/F2/F3, the one high-value cluster), test-quality (19-G), network retry/backoff (19-H, shipped in 20-G), URL-scheme hardening (19-J), bundle/CWV — size gate + deferred transitions + lazy-load (19-I2/I3/I1). **Done (2026-06-18):** all slices shipped except **19-C (Rejected** — low-value type-safety future-proofing on an already-clean codebase) and **19-K (Closed** — the TanStack Query migration graduated to **Phase 20**, which shipped). 19-I1 (lazy-load editor + transcribe SDK, CLS fallback, lazy-chunk RUM event) closed the phase.

Slices and acceptance criteria: [docs/phases/phase-19.md](phases/phase-19.md)

## Phase 20 — Server-state migration to TanStack Query _(Complete)_

Replaced the hand-rolled `useEffect`-fetch + `useState` server-state hooks with **TanStack Query** (cache, dedup, retry/backoff, stale-while-revalidate, optimistic-update-with-rollback), migrating **one domain per slice** with hand-rolled and library coexisting until the last. **Reversed [ADR 0010](adr/0010-server-state-strategy.md)** (Accepted: stay hand-rolled) via [ADR 0012](adr/0012-adopt-tanstack-query-server-state.md). Built on the `api/<domain>.ts` seam from 19-A. All seven slices shipped: **20-A** foundation + todos pilot (the `useQuery`/`useMutation`+rollback template), **20-B** folders, **20-C** cards/list (the big App.tsx consolidation; needed fix #195 for a post-merge E2E regression), **20-D** actions+tags, **20-E** note detail (the full `keys.note` migration via the draft pattern), **20-F** meetings (two date-keyed queries preserve the Phase 16 reminders decoupling), **20-G** cleanup (dead `listNotes` removed; transient-read backoff added to `apiFetch`, subsuming 19-H). The recurring lesson: a single-consumer key + optimistic == server needs no self-invalidate — patch the cache, don't refetch. Transcription credentials stay hand-rolled.

Slices and acceptance criteria: [docs/phases/phase-20.md](phases/phase-20.md)

## Phase 21 — URL routing: distinct URLs, working back/forward, shareable note links _(Done)_

The frontend has **no router** — `App.tsx` holds a single in-memory `view` union (`list` | `folder` | `note`) and opening a note is just `setView({ kind: "note", noteId })`, so the URL never changes, back/forward are no-ops, and a specific note can't be linked. This phase adopts **react-router-dom** (recorded in [ADR 0013](adr/0013-adopt-react-router-dom.md)) and maps the three surfaces — home, folder, note — to real routes (`/`, `/folders/:folderId`, `/notes/:noteId`), so back/forward work and a note or folder URL can be shared and deep-loaded. Frontend-only: no event model, API, or backend change; CloudFront already rewrites unknown paths to `index.html`. Four steps: an **ADR gate**, **21-A** (router foundation + note & home URLs — the keystone), **21-B** (folder URLs), **21-C** (deep-link edge cases: missing-note recovery, signed-out-link survival, hard-load coverage). Transient surfaces (sidebar, preview pull-out, note tabs) stay in component state.

**Goal:** client-side routing on an SPA; mapping a hand-rolled view-state union onto a declarative route table; deep-linking against an already-configured CloudFront SPA rewrite; the auth-gate-vs-route ordering problem; and the dependency tradeoff of adopting a router in a deliberately hand-rolled frontend (contrast [ADR 0010](adr/0010-server-state-strategy.md)).

Slices and acceptance criteria: [docs/phases/phase-21.md](phases/phase-21.md)

## Phase 22 — Search across notes _(Done)_

Add fuzzy free-text search across all of a user's notes from a home-screen search bar, with **no new infrastructure and no fixed cost**. A new `NoteSearchView` projection holds one searchable document per note (title, Quick notes, Final notes, tags, action-item text — **not** the raw transcript); a `GET /notes/search?q=` endpoint reads the current user's documents and **fuzzy-ranks them in-Lambda** (Levenshtein / token-set ratio), staying inside the existing DynamoDB + Lambda stack at $0 marginal cost. **22-A** builds the searchable read model + endpoint (backend-only, independently shippable); **22-B** adds the debounced as-you-type search bar (results replace the card grid, explicit no-results/error states), preceded by a throwaway UX prototype. 22-B depends on 22-A. Graduated from the "Search across notes" future-features idea.

**Goal:** build search *without* a search engine — a purpose-built read model shaped for a query and in-process fuzzy ranking over a `UserId`-scoped projection read; understand where that approach's cost/latency curve bends (linear in note count, superseded later by pagination/server-side filtering); ranking/threshold tuning as a measured concern; and the privacy discipline of never logging query text or note content.

Slices and acceptance criteria: [docs/phases/phase-22.md](phases/phase-22.md)

## Phase 23 — Workspaces _(Complete)_

Partition a user's content into named **workspaces** (e.g. *Work* / *Personal*) with a switcher, isolating notes, folders, tags, to-dos, and search per workspace. A second isolation dimension layered over the Phase 8 `UserId` scoping. Workspace membership is **domain state on the Note aggregate** — a new `NoteAssignedToWorkspace` event modelled on the existing `NoteFiledInFolder` pattern — so a note created in the wrong workspace can be **moved** (notes only in v1; moving clears the note's workspace-local folder). The active workspace is carried as a URL path prefix `/w/{wsId}/…` on both the SPA router and the API (route group + per-request validation). A reserved non-deletable default workspace ("Personal", id `__default__`) always exists, and all historical unassigned content **resolves to it at read time** — no event-log migration. Deleting a non-empty workspace is blocked; calendar/meetings stay global (one Google calendar per user). Seven slices: workspace aggregate + CRUD (23-A), write-path + note-read-model scoping (23-B, keystone), folder/to-do scoping + delete-if-empty (23-C), frontend routing + context (23-D), switcher + CRUD UI (23-E), move-note-to-workspace (23-F), cleanup + backfill (23-G). Graduated from the "Workspaces" future-features idea.

**Goal:** retrofit a second data-partition dimension across an event-sourced system without rewriting history; reuse container-membership-as-event (`NoteFiledInFolder`) for workspace membership; URL-addressed resource scoping on API and router; a reserved-sentinel default that maps immutable history forward.

Slices and acceptance criteria: [docs/phases/phase-23.md](phases/phase-23.md)

## Phase 24 — Projection rebuild robustness _(Done)_

Make `POST /admin/projections/rebuild` reliable on the first try and incapable of silent partial data loss. Today `ProjectionRebuildHandler` deletes every projection unconditionally, then re-upserts ~290 rows via one unbounded `Task.WhenAll` against a 5s-per-op DynamoDB client — a cold on-demand table throttles, writes cancel at 5s, `Task.WhenAll` throws → 500, and delete-all-first leaves the read models partially rebuilt (faulted rows silently missing). Reliable only on the second try (warm tables); confirmed in prod 2026-06-05 and 2026-06-08. Three backend-only slices: bounded+retried writes with a longer admin-path timeout (24-A, the immediate de-risk), upsert-and-reconcile to remove the delete-first window and prune `NoteSearchView` tombstones (24-B), and operability — per-projection summary, fault metric/alarm, overlapping-rebuild guard (24-C). Stays on the HTTP path at current scale; async off-loading is the documented escalation, not this phase. Graduated from the rebuild-robustness item in `technical-improvements.md`. **Unblocks** auto-backfill-on-deploy, which makes Phase 23's repeated projection backfills self-healing — worth doing **before** Phase 23.

**Goal:** DynamoDB on-demand cold-partition throttling and bounded concurrency; transient-fault retry with backoff+jitter; idempotent upsert-and-reconcile as a safer maintenance pattern than delete-then-rebuild.

Slices and acceptance criteria: [docs/phases/phase-24.md](phases/phase-24.md)

## Phase 25 — Inline images in notes (paste, drop, pick) _(Done)_

Add images to a note via **clipboard paste, drag-and-drop, or a file-picker button** and render them **inline** in the note body — primarily while a meeting is live (the "Quick notes" tab), identically when editing afterwards. Images are stored as binary objects in a **private S3 bucket** (the project's first user-data blob store); note content holds only a stable key reference, and the browser fetches each image via a short-lived **presigned GET** minted at render time. Frontend is reuse-heavy — content is already markdown rendered by Tiptap, whose `StarterKit` bundles an `Image` extension — so the net-new work is the backend media path. Three slices: backend media store + presigned upload/download with ownership+prefix authz and a server-enforced type allowlist/10 MB cap (25-A); paste/drop/pick → upload → inline render across live + edit, optimistic, with the key↔presigned `src` rewrite that never persists an expiring URL (25-B); lifecycle + analysis hygiene — delete-note purges the image prefix, image markdown stripped from the AI analysis input (25-C). 25-B and 25-C depend only on 25-A. **No new event, no new projection, no event-model change** — image refs ride in `ContentEditedV2`, bytes are external blob state. Graduated from the "Paste images" future-features idea.

**Goal:** first binary-blob path in a text/event-sourced app; browser-direct-to-S3 uploads via a presigned POST policy (size/type conditions + bucket CORS) vs proxying bytes through Lambda; minting short-lived presigned GETs at render time and the data-rot trap of persisting an expiring URL; keeping external blob state honest alongside an event-sourced aggregate.

Slices and acceptance criteria: [docs/phases/phase-25.md](phases/phase-25.md)

---

## Phase 26 — Zero-downtime deployments _(Done)_

A `cdk deploy` is not yet fully zero-downtime. The backend alias flip is seamless (API Gateway routes to the `live` alias; SnapStart avoids cold starts) but lacks canary + automated rollback. The real gap is the **frontend deploy job**: `aws s3 sync … --delete` removes old content-hashed bundles the instant new ones land, so a browser/CDN still holding the previous `index.html` 404s its bundle on reload → blank app, plus a `/*` invalidation cold-cache spike and no immutable caching. Three independently-shippable slices: frontend zero-downtime deploy — two-pass upload (immutable hashed assets, no `--delete`; `index.html` `no-cache`), entry-point-only invalidation, S3 lifecycle GC (26-A, the only current-downtime fix); a `vite:preloadError` chunk-load-error reload safety net (26-B); and a backend CodeDeploy canary wired to the existing error-rate + latency alarms for auto-rollback (26-C). Frontend-first, and **before or with Phase 19-I** — lazy-loading over today's `--delete` strategy escalates the reload-404 into a mid-session crash. Graduated from the "Zero-downtime deployments" item in `technical-improvements.md`.

**Goal:** a deploy never breaks a live user; learn immutable-asset caching vs `--delete`, CloudFront invalidation scoping, S3 lifecycle GC, Vite `vite:preloadError` recovery, and CodeDeploy canary traffic shifting with alarm-based auto-rollback on a Lambda alias.

**Outcome:** 26-A + 26-B shipped (the frontend zero-downtime fix — the real user-facing break — plus the chunk-load safety net). 26-C (backend canary) shipped then was **reverted same-day**: the canary added ~5 min to every backend deploy and serialised the deploy queue, a cost not worth its rarely-exercised rollback protection on a single-user app (see `docs/learnings/deploy-time-is-a-first-class-cost.md`).

Slices and acceptance criteria: [docs/phases/phase-26.md](phases/phase-26.md)

---

## Phase 27 — Split the API Lambda: CQRS write/read split + async projectors _(Done — core; optional RYW-D only)_

The backend runs as one `ApiFunction` Lambda that serves every route and updates all read models **synchronously inline in the command handler** (`NoteCommandHandler.UpdateProjectionAsync`) before the HTTP response returns — so projection-building is welded to the write request, one IAM role grants read/write across ~13 tables, and read/write traffic share one cold-start profile. This phase implements **Stage 1 of [ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md)**: move projection-building **off the request path onto a DynamoDB Stream** (a **Projector Lambda**) and split the HTTP surface into a **Command Lambda** (append-only, event-store IAM) and a **Query Lambda** (reads, projection-read-only IAM) — the 3-Lambda CQRS shape. The headline trade-off is accepted: **read-after-write becomes eventually consistent** (projector lags the write by stream latency, typically <1s; the frontend's optimistic updates already insulate the user, and server-side read-after-append tests move to bounded polling). Four slices: extract a shared idempotent `ProjectionUpdater` (27-A, behaviour-neutral seam); enable the stream + a Projector Lambda in **shadow** alongside the still-inline writes, with DLQ + lag/failure alarms (27-B); **cut over** to async by removing the inline updates and moving read-after-write tests to retry (27-C, the keystone consistency flip); and **split the Lambda** into Command + Query functions with least-privilege per-function IAM (27-D). Async projection failure is invisible by construction, so the `observability` skill is wired **in 27-B**, not as a follow-up. **Stage 2** (per-context command Lambdas) and **stream-replay rebuild** are explicitly out of scope. Graduated from the "Split the single API Lambda" item in `technical-improvements.md`.

**Status (2026-06-13):** 27-A + 27-B shipped; **27-C (the async cutover) was attempted and reverted** — the projector was fine, but the frontend was built for immediate consistency and flipping it raced the lag (read-after-write broke across navigation), and reactive patching was whack-a-mole. The fix is **read-your-writes / consistency tokens** (= Azure Cosmos *Session* / MongoDB causal / Postgres `WAIT FOR LSN`, applied at the projection layer), specced as **[Phase 27-RYW](phases/phase-27-ryw.md)** and now **Done (core; RYW-D optional)**: built **incrementally, flow-by-flow** — **RYW-1** proved the loop on one call (async add-a-to-do, token-gated), **RYW-2** the note flows, **RYW-3a** actions, **RYW-3b** folders+workspaces, **RYW-3c** confirmed analysis was already migrated (it rides on `note#`/`action#`) and pinned the feedback double-count closed with a guard test, and **RYW-4** completed the cutover docs + dead-code cleanup. **Result: every command handler is append-only and the async projector is the sole writer of every read model; read-after-write is delivered by consistency tokens + the `ConsistencyGate`** (session consistency). **27-D then split the single request Lambda into Command + Query functions** (PR #278) — split by API Gateway method routing + per-function least-privilege IAM (Query is read-only on projections with zero event-store data access; Command holds writes + side services + the rebuild-only projection grant), SnapStart on the read function only so deploy time stays neutral. **Live in prod (deploy #574): `CommandFunction` + `QueryFunction` + `ProjectorFunction`** — the old single `ApiFunction` is retired. **So ADR 0009 Stage 1 is complete** — the 3-Lambda CQRS shape is deployed and the async cutover the reverted 27-C couldn't land is done. Only **RYW-D** (optional SSE poke) remains. The honest 27-C write-up and the real lesson (*the projectors were the easy part; the read-after-write client contract is the work*) are in [the learnings doc](learnings/phase-27c-async-cutover-reverted.md) and [ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md).

**Goal:** the defining event-sourcing deployment lesson — an append-only log with decoupled, replayable async consumers — DynamoDB Streams as the fan-out transport, projector idempotency and replay-safety, eventual consistency and the read-after-write tests it breaks, async failure handling (DLQ + alarm), per-function least-privilege IAM, and per-method API Gateway routing to split integrations.

Slices and acceptance criteria: [docs/phases/phase-27.md](phases/phase-27.md)

---

## Phase 28 — Resize images in a note _(Done)_

Let the user resize an inline image — a **corner drag handle** (free, aspect-locked) plus an accessible **preset control** (Small / Medium / Large / Original) — with the size persisted so it round-trips on reload. **Frontend-only:** images render solely through `NoteEditor` (Tiptap + `tiptap-markdown`); there is no separate read-only renderer, preview, or card image path, and the size lives inside the existing note `content` markdown, so there is **no new domain event, backend, projection, or CDK change** (content is already event-sourced via `ContentEditedV2`; deploy-time neutral). Two slices: **28-A** adds a `width` attribute, the accessible preset control, and the persistence round-trip — carrying `width` through `tiptap-markdown` serialize/parse and the existing key↔presigned-URL rewrite (`noteImages.ts`) without it being silently dropped on save (the one real subtlety, and why the keyboard-accessible presets ship first to satisfy the jsx-a11y gate); **28-B** layers the corner drag handle on top, reusing 28-A's width persistence with no new save/load code. Graduated from the "Resize images in a note" item in `future-features.md`.

**Goal:** small, contained frontend feature; learning surface is extending a third-party Tiptap node with a custom attribute and a custom `tiptap-markdown` serialize/parse, and keeping a content-embedded attribute honest across a rewrite pipeline whose invariant is "never persist a transient/expiring URL."

Slices and acceptance criteria: [docs/phases/phase-28.md](phases/phase-28.md)

---

## Phase 29 — Notes-as-prompt: inline `/ai` instructions in a note _(Done)_

Let the user embed an instruction in their Quick notes that the AI **executes** during analysis, with each result shown as its own labelled block in Final Notes. A line prefixed `/ai ` (e.g. `/ai add an agenda for the weekend`) becomes an instruction; everything else is summarised as today. The pipeline is reused almost wholesale — the note already reaches the model — so the work is three things: **extract** the `/ai` lines so they drive execution instead of being summarised; a new prompt version (`analysis@v7`) that **executes** each instruction and returns `instructionResponses: [{instruction, response}]` while keeping the summary grounding-first; and a new **additive event `InstructionResponsesRecorded` → `NoteDetailView` field → per-instruction cards in `FinalNotesView`**. Two slices: **29-A** is the whole feature end-to-end on one real `/analyse` call (extractor + v7 + event/projection/UI, back-compat when no `/ai` line, **eval-gated** so v7 ships only after `make eval` proves no summary-quality regression vs v6); **29-B** adds a discoverability affordance so `/ai` is findable (pure UX, may fold into Stylist). Because it changes the analysis prompt it is eval-gated like a `phase-model-prompt-improvements` item; no new CDK resource and no projection backfill (the new field is correctly empty for historical notes), so deploy-time is neutral. Graduated from the "Notes-as-prompt: inline AI instructions in the user's notes" item in `future-features.md`.

**Goal:** turn user content into prompt control safely — the learning surface is the grounding-vs-execution prompt split measured by the eval harness, an additive event extending an existing projection without a rebuild, and a provable back-compat path (no `/ai` line ⇒ byte-for-byte today's behaviour).

Slices and acceptance criteria: [docs/phases/phase-29.md](phases/phase-29.md)

## Phase 30 — Durable sign-in (no re-authorise) _(Core done — 30-A/B/C; 30-D deferred)_

Make sign-in behave like a normal SSO app: the Google scope-approval ("re-authorise") screen appears **once, ever**, never on return. Root cause today — the Google refresh token lives **only** in the `rt` browser cookie, so any cookie loss (idle > 30 days, cleared cookies, a new browser) leaves the backend with no token and the only way to get one back from Google is to force `prompt=consent`, i.e. the re-authorise screen. The fix persists the refresh token **server-side** keyed by the user's Google `sub` (encrypted DynamoDB table), so a returning user is restored from the store with a plain sign-in and no consent — exactly how mature SSO apps avoid re-authorising. The OAuth app is already **Published** (refresh tokens long-lived; confirmed via a 15-day-old still-working calendar token), so a stored token effectively never expires. Four slices: **30-A** the server-side store + restore-on-login (core); **30-B** drop forced `prompt=consent` on returning sign-ins; **30-C** the [BUG-33](phases/phase-bugs.md#bug-33) warm-tab fix (try the refresh before signing out on idle-return — pure frontend, ships first); **30-D** `/auth/refresh` server-side-store fallback. New encrypted table is a one-off CDK add (no projection backfill); deploy-time neutral.

**Goal:** match the standard SSO durability contract — consent is a one-time grant, not a per-login event — by giving the refresh token a durable server-side home keyed to the user identity.

Slices and acceptance criteria: [docs/phases/phase-30.md](phases/phase-30.md)

---

## Phase 31 — Desktop app (no per-meeting audio-share consent) _(Done — Windows shell, pinned loopback grant, unsigned installer, CI-published auto-update; final install round-trip is a manual Windows step)_

Remove the browser's per-meeting screen-share picker + consent when capturing call/system audio, by packaging the existing frontend as a **Windows Electron desktop app**. The whole trick is the Electron main-process `session.setDisplayMediaRequestHandler`, which auto-answers each display-capture request with `{ video: <screen>, audio: 'loopback' }` — the renderer's existing `getDisplayMedia` call resolves with **no picker and no per-meeting consent**, just a one-time OS grant per machine. Feasibility was proven by the 2026-06-03 Windows spike. **Zero backend/CDK/event-model changes** — `web/` and the transcription path are reused as-is. Locked decisions: **Windows only** (the proven path; macOS deferred), **bundle-shell** (compiled `web/` assets shipped in-app, loaded from disk, calling the live prod API — so the shell always opens and the client is version-pinned), **unsigned personal build** via `electron-builder` (no signing/auto-update). Four slices: **31-A** Electron shell loads the bundled frontend + Google sign-in works in-window (de-risks OAuth-in-Electron); **31-B** the main-process auto-grant — record with no picker (core value); **31-C** package as an unsigned Windows installer; **31-D** CI publishes the installer to GitHub Releases after each successful prod deploy so `npm run update` updates by pulling (no local rebuild). Deploy-time impact on the prod pipeline: **neutral** (the desktop build/publish is a separate post-deploy workflow, not in `deploy.yml`).

**Goal:** an installable Windows app that records meetings with system audio after a one-time OS grant — no per-meeting screen-share consent — reusing the existing frontend, transcription path, and API unchanged.

Slices and acceptance criteria: [docs/phases/phase-31.md](phases/phase-31.md)

---

## Phase 32 — Microsoft 365 (Outlook) Calendar Integration _(Done)_

Back the home-screen meetings list with the owner's **Microsoft 365 / Outlook** calendar instead of Google, reusing every existing calendar consumer (create-note-from-meeting, reminders, recurring next-occurrence) unchanged. Mirrors Phase 9's Google model: a refresh token minted out-of-band and stored in SSM, exchanged for an access token per call, read via Microsoft Graph `/me/calendarView` (which expands recurrences server-side, the Graph equivalent of Google's `SingleEvents=true`). A 2026-06-22/23 spike proved the auth path, the `Calendars.Read` scope, and the field mapping on one real call against a personal Outlook account. Locked: **one provider at a time** via a `CALENDAR_PROVIDER` env switch (default `google`; merged calendars out of scope); **token minted out-of-band** (the MSAL device-code spike promoted to a one-shot minting tool → SSM, no in-app consent UI); **public client, no client secret**; **force UTC** via `Prefer: outlook.timezone="UTC"`. Two slices: **32-A** — *see your Outlook meetings on Home and create a note from one* (keystone, core value); **32-B** — *create a note for the next occurrence of a recurring Outlook meeting*. Deploy-time impact: **neutral** (env vars + one IAM grant; no new table, no projection backfill).

**Goal:** the owner sees and creates notes from their Outlook calendar meetings on the home screen, with the Google integration preserved behind the same interface.

Slices and acceptance criteria: [docs/phases/phase-32.md](phases/phase-32.md)

---

## Phase 33 — Higher-quality speaker-labelled transcripts via Amazon Transcribe batch _(Done)_

After a recording stops, produce a cleaner, **speaker-diarized** transcript than live streaming gives by running an **Amazon Transcribe batch** job (`ShowSpeakerLabels`) over the captured audio, replacing the streamed transcript and re-analysing. Live streaming stays for the in-call experience; batch is a **post-call refinement** that coexists with it (no big-bang cutover). A 2026-06-23 spike compared engines on a real recording and **chose Transcribe batch** (cleaner separation *and* tighter text than WhisperX-`small`+pyannote, no local ML stack); it **rejected** channel-ID and offline echo cancellation for local/remote separation — on a speakers setup the mic re-captures the system audio, and a delay-aligned FDAF/NLMS AEC failed to remove the bleed (~1 dB ERLE, transcript unchanged). Three slices: **33-A** *(done)* — *save the call recording* (tee the live 16 kHz mono PCM to a WAV, upload to a 7-day-expiry `notetaker-recordings` S3 bucket, downloadable; the audio-retention enabler with standalone value); **33-B1** — *diarized transcript replaces the streamed one, async path* (batch job → EventBridge → a new dedicated completion Lambda → new `TranscriptionDiarized` event → transcript replaced, with a "Refining…" chip; **no re-analysis** — proves the async job→event→read contract on one real call); **33-B2** — *re-analysis on the diarized transcript* (extract the analysis flow into a non-HTTP callable the completion Lambda invokes). Deploy-time impact: **neutral** (one-off infra add: S3 bucket + EventBridge rule + new Lambda + IAM; no traffic-shifting). Runtime cost ≈ $0.024/min of audio per recording.

**Goal:** a recorded call yields a speaker-labelled, higher-accuracy transcript after stop, without losing the live in-call transcript.

Slices and acceptance criteria: [docs/phases/phase-33.md](phases/phase-33.md)

---

## Phase 34 — Per-workspace calendars (in-app connect, multi-account) _(Done — incl. 34-E ICS feed)_

Let each **workspace** back its meetings list with its own connected calendar account and provider — workspace A on a Google account, workspace B on Outlook — instead of one global calendar. Reached by **strangling** the single-calendar model: first replace the out-of-band SSM refresh token with an **in-app "Connect calendar" OAuth flow** (auth-code+PKCE, token exchanged + stored **server-side per entity** — this graduates **TI-47**), then **key the token + provider choice by workspace** via a new `WorkspaceCalendarConnected` event on the `Workspace` aggregate, then make provider selection **per-request** via an `ICalendarClientFactory.For(workspaceId)` (dropping the global `CALENDAR_PROVIDER` env), then retire the SSM path + mint scripts. Reuses Phase 8's Google OAuth and Phase 32's Microsoft Graph client unchanged — only the token source and provider resolution change. Four sequential slices: **34-A** in-app Google connect → server-side per-user token (keystone, SSM fallback during coexistence); **34-B** key the connection by workspace; **34-C** add Outlook as a connectable provider + per-request resolution; **34-D** retire the SSM path. Deploy-time impact: **neutral** (reuses the auth-tokens table; 34-D removes SSM grants/env). One-time prerequisite: register the calendar redirect URI in Google Cloud Console + Entra.

**Goal:** each workspace independently connects and shows its own calendar (Google or Outlook), with all calendar auth done in-app and stored server-side per workspace.

Slices and acceptance criteria: [docs/phases/phase-34.md](phases/phase-34.md)

---

## Phase 35 — Claude Cowork connector (read-only MCP server) _(Done)_

A **read-only remote MCP server** that lets Claude **Cowork / Desktop / claude.ai** connect to a workspace as a **custom connector** and digest its notes — list, read, search, pull action items — in the user's own Claude session. For these clients a custom connector **is** a remote MCP server (the only native mechanism; they can't call a plain REST API), built with the official **`ModelContextProtocol.AspNetCore`** SDK over the **existing** read projections — **no new aggregates or events**. Scoped to **one workspace per connector URL** (`/w/{wsId}/mcp`, matching the Phase 23/34 routing — no in-protocol workspace selection). **Auth is staged — prove first, harden second:** **35-A** *connect & list* ships **no-auth** (unguessable per-workspace URL + Anthropic-IP allowlist) to prove the MCP transport + Cowork handshake + workspace-scoped read on one real call (tool `list_notes`; the high-risk slice); then independent tool additions on the proven pattern — **35-B** `get_note`, **35-C** `search_notes`, **35-D** `get_action_items`; then **35-E** adds the **OAuth 2.1 broker over Google** (Resource Server + thin AS minting audience-bound tokens, RFC 8707) that flips the connector to authenticated — required before production-complete, deferred past the proof, not dropped. **Read-only this phase** — read+write (Claude creating notes) is a later phase. Infra: tool-call POSTs pin to the **Query** Lambda (read-only); 35-E's OAuth endpoints to the **Command** Lambda (Google client). Deploy-time impact: **neutral** (route group + reuse of existing tables; no bake/canary).

**Goal:** the owner adds a per-workspace connector URL in Cowork and Claude can digest that workspace's notes — read-only, isolated to that workspace; no-auth to prove it, then Google-OAuth-hardened (35-E).

Slices and acceptance criteria: [docs/phases/phase-35.md](phases/phase-35.md)

---

## Phase 36 — Theme per workspace _(Done)_

Let each **workspace** carry its own visual theme, so the active workspace's look switches automatically on workspace change — a quick way to tell a client workspace from a personal one at a glance. Theme today is **global** (one `[data-theme]` on `<html>`, 12 themes in `tokens.css`, persisted in localStorage). This phase makes it a **server-stored, per-workspace setting** via a new additive `WorkspaceThemeSet` event on the existing `Workspace` aggregate, folded into `WorkspaceListView` and read over the existing `GET /workspaces` — reusing the existing 12 themes and `ThemePicker` wholesale (no accent-only token split, no new component). Two slices: **36-A** *set & apply per-workspace theme* (keystone — event → projection field → `PATCH /workspaces/{id}/theme` → the sidebar picker becomes workspace-scoped, applies on switch); **36-B** *FOUC-free cold load* (bootstrap reads the cached per-workspace theme from the URL `wsId` pre-mount). The **default** workspace keeps today's global localStorage theme (its stream is shared across users — same constraint Phase 34 hit). Builds on the Phase 34 per-workspace pattern. Deploy-time impact: **neutral** (additive event + one field on an existing projection/table; no new infra, no backfill).

**Goal:** in a workspace, pick a theme; it applies instantly, persists server-side, and re-appears on return — while other workspaces keep their own.

Slices and acceptance criteria: [docs/phases/phase-36.md](phases/phase-36.md)

---

## Phase 37 — Reorder the home To Do list (drag-and-drop) _(Done)_

Drag (or keyboard Move up/down) the home **To Do** open items into any order, persisted per workspace. Scope is the home page list only; per-note action ordering is out of scope. The list interleaves two aggregates (`Todo`, `ActionItem`), so ordering lives in a dedicated per-workspace stream (`todo-order#<workspaceId>` + `TodoOrdering` aggregate) emitting a full-order-snapshot `TodoListReordered` event — item aggregates untouched. The projection folds it into a nullable `Position` on `TodoItem` (sort `Position ?? max`, then `AddedAt`); reorder is optimistic and RYW-correct via the order-stream consistency token. No DnD library (reuses the native `FolderTree` drag pattern); keyboard reordering via Move up/down buttons keeps the jsx-a11y gate green. Deploy-time impact: neutral (no new table, no backfill — `Position` is a new attribute on the existing `TodoList` table). Single slice **37-A** (shipped). Graduated from the "Drag-and-drop to reorder to-do / action items" future-features idea.

**Goal:** reorder the home To Do open items; the order persists per workspace and survives reload.

Slices and acceptance criteria: [docs/phases/phase-37.md](phases/phase-37.md)

---

## Phase 38 — Import a transcript manually _(Done)_

**Value:** today only meetings recorded *live in the app* get summarised, action-itemed, and tagged — so a Zoom/Teams transcript a colleague sends you, or a meeting recorded on another device, can't benefit. This lets the user **paste any transcript and get the same AI analysis**, making the app useful for *every* meeting they have a transcript for. Also de-risks the bigger Zoom/Teams auto-connector (manual paste proves import-and-analyse first).

Let the user add a transcript they **already have** — paste raw text captured in an external tool — to a note, which feeds the **same analysis pipeline** (summary, action items, tags) as a recording. **Reuses the recorded-note path** (`CompleteTranscription` → analysis events) — **no new command or event**; analysis reads the pasted text via `transcriptOverride`, sidestepping the Phase 27-RYW async-projection race (the just-appended transcript hasn't reached the projection). Two slices: **38-A** proved the import-and-analyse flow by pasting into a *new* note (one server-side call); **38-B** then pivoted it (per user feedback) so import targets the **open note** — note-scoped `POST /w/{ws}/notes/{noteId}/import-transcript` (replace the transcript + re-analyse), a **Paste transcript** button + modal on the note's Transcript tab (next to Record, with a replace-confirm), and the home create-new button removed. Plain text only; date/attendees and speaker-labelled formats deferred. The **manual-paste ingestion path** that de-risks analyse-an-imported-transcript before any third-party connector (Zoom/Teams). Deploy-time impact: **neutral** (routes on the existing Command Lambda; no new event/projection/table/infra/backfill).

**Goal:** paste a transcript into the open note; it replaces any existing transcript and re-analyses — identical to a recording minus audio.

Slices and acceptance criteria: [docs/phases/phase-38.md](phases/phase-38.md)

---

## Phase 39 — Edit the text of a to-do / action item _(Done)_

Let the user **edit the text** of an existing action item (on a note) or standalone home to-do — today the text is fixed once created (only complete/reopen/delete exist), so a mis-captured or AI-extracted item can only be fixed by delete-and-recreate. The design was already in the event model (`EditActionItem`/`ActionItemEdited`, documented but unimplemented), and `Description` already exists on every read view, so it's a projection *fold*, not a schema change — **no new aggregate/table/backfill/CDK; deploy-time neutral.** Two slices: **39-A** *edit a note action item* (keystone — new event/command, `PUT /notes/{noteId}/actions/{actionId}` with the RYW token, all four rebuild projections + the async `ProjectionUpdater` folding the edit into `NoteActions`/card rollup/search/`TodoList` action row, inline optimistic click-to-edit) — **done, live 2026-06-25**; **39-B** *edit a standalone to-do* (same pattern on the `Todo` aggregate) — **done, live 2026-06-26**. Graduated from the "Rename to-do / action items" future-features item.

**Goal:** complete a documented-but-unimplemented command; a purely additive event that mutates only a projection's existing field; keep an optimistic inline-edit honest under the async projector + RYW.

Slices and acceptance criteria: [docs/phases/phase-39.md](phases/phase-39.md)

---

## Phase 40 — Home notes: richer default, date-range filter, and sort _(Done)_

Replace the home-screen notes model the user dislikes — "today's notes only + an opt-in *show older* toggle" — with **more notes by default**, an explicit **date-range filter**, and a **sort** control (by date and title, both directions). The disliked *show older* toggle (CHANGE-19) and today-only default (CHANGE-3) are retired and replaced by the date-range filter's default window. **Frontend-only:** the home card list already loads the full card set and filters/sorts client-side (`useNoteCards()` → `GET /notes/cards`; `ListView.tsx`), so default-window, date-range, and sort are all client-side over the loaded set — **no new event, command, projection, endpoint, or CDK change → deploy-time neutral.** Server-side date/sort over a *paginated* set is explicitly out of scope (that is the separate "Scalable note loading" future-feature; this phase must not pre-empt it). **Prototype-gated** because the UX is uncertain: a throwaway frontend prototype (40-P) settles the default window, the date-range control shape, and the sort control before implementation. Three steps: **40-P** prototype; **40-A** new default + date-range filter (keystone — retires *show older*, URL-persisted so Back/reload/share restore the view); **40-B** sort control. The save-button "return to where I came from" was considered and **dropped** — the existing `navigate(-1)` + URL-persisted filters already do this.

**Goal:** show more notes by default, filter by date range, and sort the home list — a UX-uncertain redesign settled by a throwaway prototype, kept client-side and URL-addressable while honouring the boundary against the pagination future-feature.

Slices and acceptance criteria: [docs/phases/phase-40.md](phases/phase-40.md)

---

## Phase 41 — MCP write tools (Claude can create & update notes and to-dos) _(Done — 2026-06-26)_

The Phase 35 connector is read-only (its locked decision #2 deferred writes to "a future phase"); this is that phase. From a connected Claude session the owner can create a note, add/complete/reopen a to-do, and edit a note's body — Claude writes back through MCP, not just reads. **No event-model changes:** every write reuses an existing command (`CreateNote`, `AddActionItem`, `Complete`/`ReopenActionItem`, `ContentEdited`). The one cross-cutting change is infra — `/mcp` POST moves from the **Query** Lambda to the **Command** Lambda (only Command has event-store access; it already holds the projection grants the read tools need, so reads keep working). **Deploy-time neutral.** Three slices: **41-A** moves the endpoint + `create_note` (proves the write pipe on one real call), **41-B** action-item writes, **41-C** `edit_note`.

**Goal:** from a connected Claude session the owner can save a new note, manage a meeting's to-dos, and edit a note's body — write-back over the MCP connector.

Slices and acceptance criteria: [docs/phases/phase-41.md](phases/phase-41.md)

---

## Phase 42 — Calendar access through the MCP _(Done)_

Extends the MCP connector (Phases 35/41) to the **calendar**. From a connected Claude session the owner can list a workspace's meetings for a date and create calendar-linked notes (from a meeting, or the next occurrence of a recurring series). **No event-model changes:** the read reuses the existing calendar client chain; the writes reuse `CreateNote`/`RenameNote`/`SetNoteDate`/`LinkNoteToCalendarEvent` through the generic identity-explicit handler overload. The one cross-cutting change is identity/workspace resolution — the calendar chain resolves the workspace from the **URL route** (`ICurrentWorkspace`), which the `/mcp` path lacks, so a scoped `ICalendarScope` lets the tools resolve the calendar for an explicit `(sub, workspaceId)`. **No infra change** (calendar services already on the Command Lambda that serves `/mcp`); deploy-time neutral. Two slices: **42-A** `list_meetings` + the off-route resolution (proves the pipe), **42-B** the two calendar-linked note-creation tools.

**Goal:** from a connected Claude session the owner can read a workspace's meetings and create calendar-linked notes — calendar access over the MCP connector.

Slices and acceptance criteria: [docs/phases/phase-42.md](phases/phase-42.md)

## Phase 43 — Meeting agenda (topics to discuss) _(In Progress — 43-A–F done; 43-G/H remain)_

Each note has an **agenda** — a checklist of topics the owner adds before/during a meeting and ticks off as covered, shown in the note **header** (expanded by default, collapsible to one "X / Y" line) and costing **no side space**. Five slices are live: **43-A** add, **43-B** tick/untick + coverage, **43-C** edit/remove, **43-D** collapsible strip + Stylist, **43-E** retired the legacy heading-✓ (BUG-37's "a topic = a heading" conflation). **A 2026-08-07 prototype + interview then re-cut the model**: because meeting notes are running prose rather than a section per topic, the heading-anchored tick could never fire — so the agenda moves *into* the body. Every task-list line in a note becomes a topic, the **body is canonical**, the tick is `- [x]` (a `ContentEdited`, not an agenda event), and the header strip becomes a view that writes back through the editor. Notably this needs **no identity token in the markdown** — the line *is* the item. **43-F** is live (#428, deploy #724): topics derive from the body, ticking in the notes moves the count, and derived topics show read-only in the header until 43-G. Two remain: **43-G** header write-backs (undoable, merging with unsaved typing), **43-H** migrate the straggler notes then drop the legacy path. Strangler-ordered; deploy-time neutral throughout. Detail: [docs/phases/phase-43.md](phases/phase-43.md).

Slices and acceptance criteria: [docs/phases/phase-43.md](phases/phase-43.md)

## Phase 44 — Change or remove a note's linked meeting _(Done)_

Let a note that's already tied to a meeting be **re-pointed at a different meeting** or **detached entirely**, for when the plan changes — the meeting gets replaced, or the prep notes turn out to fit another meeting. Today the Note aggregate hard-blocks re-linking (throws when already linked) and there is no unlink at all. Reframing from scouting: a *rescheduled* meeting usually keeps the same calendar event ID, so "the meeting moved" is often just a stale cached time (auto-refresh — deferred to *Later*); this phase covers the cases that need a user to act. Two slices: **44-A** change the meeting (re-pick any free meeting; old meeting freed, new one claimed; optimistic swap), **44-B** unlink (note becomes standalone, content untouched). Leans on the existing `CalendarLinkView` projection — one new event (`NoteUnlinkedFromCalendarEvent`), no new table, no backfill, neutral deploy-time.

**Goal:** move a note to a different meeting, or detach it from its meeting entirely, when the meeting gets rescheduled, replaced, or the notes turn out to fit a different meeting.

Slices and acceptance criteria: [docs/phases/phase-44.md](phases/phase-44.md)

---

## Phase 45 — Data backup & durability hardening _(In Progress — 45-B done 2026-07-01)_

Make the owner's data survive an accidental delete or corrupting write, not just a stack teardown. Today only `RemovalPolicy.RETAIN` guards the stores — that stops a `cdk destroy` but not a bad write, a mis-run migration, or a stray `DeleteTable`; and only the (rebuildable) calendar-link projection has point-in-time recovery. Slices are ordered by **permanence of loss**, not blast radius. Five slices, all pure infra (spec'd as `Infrastructure.Assertions` template checks, deploy-time neutral): **45-A** PITR on the event store (keystone — catastrophic, unrecoverable loss); **45-B** S3 versioning + non-current expiry on the note-images bucket (uploaded images are the *only copy* — an unversioned overwrite/delete is permanent); **45-C** `DeletionProtection` (+ PITR) on the token tables (auth/calendar/MCP) and the event store — widest blast radius (a table drop forces mass re-consent) but the tokens are re-mintable, so the guard is deletion-protection not PITR; **45-D** PITR on the rebuildable projection tables (restore-speed only, lowest priority); **45-E** a scheduled AWS Backup plan/vault for longer-retention off-table recovery plus a DR runbook stating RPO/RTO. 45-E's off-table/cross-region scope is a confirm-at-slice-start decision — match resilience cost to a single-user app.

**Goal:** every irreplaceable store has point-in-time recovery, versioning, or a scheduled backup behind it — so a mistaken delete or bad write is recoverable, not permanent.

Slices and acceptance criteria: [docs/phases/phase-45.md](phases/phase-45.md)

## Phase 46 — Richer markdown in notes: tables, task lists, emoji _(Done — 2026-07-01)_

Close the gap between the markdown authors write and what a note renders. Tables collapse into a run-on line, `- [ ]`/`- [x]` show as literal brackets, and `:shortcode:` emoji stay raw. This is **frontend-only**: notes are edited in a Tiptap WYSIWYG editor where markdown is just the storage format (via `tiptap-markdown`, which wraps markdown-it) — there is no separate renderer to swap. The P0 breakage is a missing ProseMirror schema node, not a missing parser: `tiptap-markdown` already parses and serializes tables and task lists, so both round-trip once the matching Tiptap node extensions are wired in. Three slices, no backend/event/projection change, deploy-time neutral: **46-A** GFM tables render as a real grid with alignment (install `@tiptap/extension-table*`); **46-B** interactive task-list checkboxes (wire the already-installed `TaskList`/`TaskItem`), toggle saves optimistically; **46-C** `:shortcode:` → emoji via a load-time transform + a typing input rule. Footnotes, math (KaTeX), and definition lists are deferred as high-cost custom-node work (→ future-features); blockquote polish + image alt-on-failure are logged as CHANGE-30/31.

**Goal:** a note's markdown renders GFM tables as a grid, checklists as tickable checkboxes, and `:shortcode:` emoji as the glyph — instead of collapsed, literal, or raw text.

Slices and acceptance criteria: [docs/phases/phase-46.md](phases/phase-46.md)

---

## Phase 47 — Folder administration via the MCP _(Done — 2026-07-01)_

Extend the MCP write tools so Claude administers folders over the connector — the folder admin that until now needed the web app. Reuses the Phase 5 folder aggregate + FolderTree projection and the Phase 41/42 workspace-authorized tool pattern; the one new contract is an identity-explicit `IFolderCommandHandler` overload (note-handler style, 33-B2) so the tools call it off the HTTP route. Four slices, deploy-time neutral (new tools on the existing `/mcp` Command-Lambda endpoint, no CDK change): **47-A** list + create folders (proves the pipe, adds the overload); **47-B** file a note into a folder (reuses the existing note-filing command); **47-C** rename + delete (delete cascades, unfiling notes); **47-D** reparent, optional (rejects cycles). Adding the tools crosses the Phase-42 ≤13 tool cap → raise it. Folder-write authorization binds the folder's own owner (BUG-41) via the event stream, not the async projection (BUG-30).

**Goal:** you can have Claude create, rename, delete, and reorganise folders and file notes into them straight from the MCP connector — folder admin that until now needed the web app.

Slices and acceptance criteria: [docs/phases/phase-47.md](phases/phase-47.md)

---

## Phase 48 — Local on-device transcription & diarization _(In Progress — 48-A/B/C/E done; 48-D group diarization Not Started)_

Graduate the *Local on-device transcription* future-feature into a phase now the spike has cleared its go/no-go. Run speech-to-text and speaker diarization **entirely on the machine** inside the existing [Phase 31](phases/phase-31.md) desktop shell, driving marginal transcription cost to $0 (cloud projects to ~$40–260/mo at the user's ~3 hr/day target). Reuses the shell's mic+loopback capture and the existing transcript→note path — aims for zero backend/CDK/event-model change (desktop + a desktop-only setting only); the web app keeps cloud Transcribe. Engines run in the Electron main process (`whisper.cpp` CLI + `sherpa-onnx` diarization, no torch/HF), models download in the background on first launch (installer stays ~82 MB), cloud is the fallback until ready. Five slices: **48-A** live local transcription behind an on/off setting (proves the flow end-to-end + the live-latency unknown); **48-B** higher-quality `medium.en` pass on stop; **48-C** 1:1 who-said-what via source separation + VAD; **48-D** group who-said-what via sherpa-onnx + TitaNet-large, speaker count from calendar attendees (spike ~14% DER); **48-E** a privacy setting to keep audio fully on-device. Spike: [docs/spikes/local-whisper-transcription.md](spikes/local-whisper-transcription.md).

**Goal:** record a meeting in the desktop app and get the live transcript, the final transcript, and speaker labels produced entirely on your machine — no per-minute cloud transcription or diarization cost.

**Post-ship reality check (2026-08-07):** the live on-device path had **never actually run** since 48-A/[BUG-53] shipped — the resident server was being spawned as `whisper-cli`, which exits on `--host` ([BUG-56], fixed #426/deploy #729). The headline benefit of the phase was therefore absent from every installer until now, and it fails-visibly rather than silently from here. It is still unproven on real hardware: see MANUAL-VERIFICATION §BUG-56 and [TI-59](technical-improvements.md) for the Windows smoke test that would have caught it.

Slices and acceptance criteria: [docs/phases/phase-48.md](phases/phase-48.md)

---

## Phase 49 — Open multiple notes at once _(In Progress — 49-A done 2026-07-28; 49-B PR #414 CI-green, awaiting merge)_

Graduate the *open multiple notes at once* future-feature into a phase. Today opening a note replaces the one you were on (`/w/:wsId/notes/:noteId` is the whole page), so comparing or working across two notes means bouncing via the notes list. This phase adds an **open-note tab bar** above the note view: several notes open, one visible, click to switch, `×` to close, address bar following the active tab. **Frontend-only — no commands, events, projections, endpoints or CDK**; the open set is client-side and persisted per device (the user ruled out server-side sync). Three slices: **49-A** the tab bar itself (open, switch, close — only the active tab is mounted, so the note lifecycle is unchanged); **49-B** open tabs survive a reload (per-workspace `localStorage`, deleted notes reconciled away); **49-C** a recording keeps running in a background tab (the one slice that changes the mounting model — `useTranscription` must not be torn down, the failure BUG-34 was filed for). **49-A shipped 2026-07-28** (#410, deploy 30402913987): the plan's open question resolved the other way — a tab click is a router `navigate`, invisible to the BUG-34 popstate trap, so `NoteView` now registers a leave guard while recording. Review also surfaced [BUG-54] (sidebar/Home navigation kills a recording — pre-existing).

**Goal:** you can keep several notes open at the same time and switch between them from a tab bar, instead of losing the note you were on every time you open another.

Slices and acceptance criteria: [docs/phases/phase-49.md](phases/phase-49.md)

## Phase 50 — The Today line in the To Do list _(In Progress — 50-A implemented, PR #423 awaiting CI)_

Graduate the *expand the to-do functionality for today and the future* future-feature into a phase — **re-scoped on the way to contain no dates at all**. The original sketch assumed due/scheduled dates and calendar-derived Today/Upcoming/Overdue grouping; the user ruled that out (2026-08-06): today is *"an arbitrary line in the priority"*, drawn wherever they choose. So this phase adds a **user-positioned divider** to the existing ordered To Do list — items above it are Today, items below are Later — persisted as an additive new event on the existing `TodoOrdering` aggregate, with the grouping itself a frontend split of the already-ordered list. Two slices: **50-A** the line exists, drags to any position, and sticks across reloads; **50-B** one-click "Move to Today" / "Move to Later" so an item crosses the line without a drag (also restoring a keyboard reorder path lost in CHANGE-29). Pairs with [CHANGE-34] (send a to-do to the top/bottom) which ships independently on the same list. **50-A is implemented and locally green (PR #423), not yet merged**; two design decisions moved during the build — the line is keyed **per user and per workspace** (a workspace-only key let two users overwrite each other via the shared `__default__` workspace), and a lost anchor is relocated **durably in the projector** rather than resolved on read, because a completed anchor ages out of the read window after ~2 days and the read would then silently drop the line to the bottom.

**Goal:** you can draw a line anywhere in your To Do list to mark where "today" ends, so the top of the list is what you're actually doing now.

Slices and acceptance criteria: [docs/phases/phase-50.md](phases/phase-50.md)

## Phase 51 — Tabs redesign _(Not Started)_

The note screen stacks **two unrelated tab strips** — Phase 49's open-note bar above the note's own Quick notes / Transcript / Final notes tabs — and the lower strip lies about what the note holds: `NoteView` renders all three tabs unconditionally, so a typed-only note still offers an empty Transcript tab and a Final notes tab you must click to find is empty. This is a design question, so it is **prototype-led**: **51-A** is a throwaway frontend-only spike presenting at least three genuinely different directions (hide-until-populated, always-present-but-visibly-empty, collapse the two strips into one hierarchy); **51-B** ships whichever the user picks and is deliberately left unspecified until the spike's exit procedure rewrites its scenarios into the phase doc. Expected frontend-only — the data needed to drive a conditional or badged tab strip is already loaded in the component.

**Goal:** the tabs on a note screen tell you at a glance what that note actually has in it, instead of showing the same three tabs whether or not there is anything behind them.

Slices and acceptance criteria: [docs/phases/phase-51.md](phases/phase-51.md)

---

## Standing tracks and planning docs

Alongside the numbered phases above, work is tracked in five standing docs. The roadmap summarises them; each doc owns its content.

### Bugs _(Ongoing)_

An unnumbered, standing phase capturing defects in the deployed app, tracked to a fix. No learning theme, no fixed sequence.

**Open now (8):** **BUG-64** `shell.e2e.ts` flakes the new desktop PR gate on a cold Electron launch (fixed in #426; awaiting the 10-clean-run bar) · **BUG-59** a save into a deleted note says "try again" forever · **BUG-58** analyse hangs to the 29 s Lambda timeout (no Bedrock deadline) · **BUG-60** a browser that refuses storage crashes the app on the auth/calendar paths · **BUG-55** sign-out during a *local* finalise 401s the transcript commit · **BUG-49**, **BUG-48**, **BUG-46**.
49 bugs are fixed. The [Summary table](phases/phase-bugs.md#summary) is the full index (one row per bug, every status); condensed write-ups of the fixed ones live in [phase-bugs-archive.md](phases/phase-bugs-archive.md). This section deliberately does **not** re-list them — the table is the single source.

→ [docs/phases/phase-bugs.md](phases/phase-bugs.md)

### Minor Changes _(Ongoing)_

An unnumbered, standing phase for small tweaks and changes to existing behaviour that don't warrant a numbered phase and aren't defects. **Outstanding (5).** Four are **implemented with PRs open**, blocked on the 2026-08-06 GitHub Actions outage: **CHANGE-30** blockquote visual polish (#420) · **CHANGE-31** show image alt text when a note image fails to load (#421) · **CHANGE-32** pin the desktop microphone grant (#419) · **CHANGE-34** send a to-do to the top or bottom of the home To Do list (#422). Still open: **CHANGE-33** name the destination in the "Still recording —" leave confirm. 32 changes have shipped; the [Summary table](phases/phase-minor-changes.md#summary) is the full index — this section does not re-list them.

→ [docs/phases/phase-minor-changes.md](phases/phase-minor-changes.md)

### Model & Prompt Improvements _(Ongoing)_

An unnumbered, standing phase for iterative improvements to the AI analysis — new `analysis@vN` prompts, model swaps, judge changes — each justified by an eval delta from the 10-G harness. Open-ended by design: as long as quality can be pushed higher, items are added, measured with `make eval`, and shipped. The [`eval-run`](../.claude/skills/eval-run/SKILL.md) skill appends the next suggested item after each run (with the user's go-ahead) and maintains the companion [`docs/eval-runs/`](eval-runs/) reports and [`test-matrix.md`](eval-runs/test-matrix.md). Latest (2026-07-26): prod runs **Opus 4.6 + `analysis@v10`**. The "capture my style" gap was **model-gated** — **MPI-11** swapped Nova Lite → Opus 4.6 (the big jump), **MPI-9** added the style-tuned `analysis@v9`, and **MPI-12** shipped `analysis@v10` (style reverse-engineered by Opus 4.6 from the user's own notes, shipped on human judgment). The prompt lever is now at its ceiling — the remaining gap is structural (a freeform nested-note output, in [future-features.md](future-features.md)). See [`phase-model-prompt-improvements.md`](phases/phase-model-prompt-improvements.md).

→ [docs/phases/phase-model-prompt-improvements.md](phases/phase-model-prompt-improvements.md)

### Future Features

Possible user-facing features not yet committed to a numbered phase. When one is picked up it becomes a numbered phase here and its entry is reduced to a graduated-to pointer. **Currently open (11):** scalable note loading (pagination) + server-side filtering, which is the home of server-side folder tag search · dynamic folders (saved tag-based views) · desktop app auto-update (Chrome-style) · in-app microphone selector · meeting-capture audio quality mode · connect to external transcript tools (Zoom, Teams) · advanced markdown (footnotes, KaTeX, definition lists) · distinguish raw meeting notes from AI-structured notes when browsing · per-note analysis "lens" · freeform structured note output.

→ [docs/future-features.md](future-features.md)

### Technical Improvements

Technical, infrastructure, and developer-experience items to address in the future (refactors, upgrades, CI/CD, hardening). **21 open or partly-done.** The ones most likely to bite next: move `WorkspaceList`/`NoteCardList` off full-table `Scan` to a per-user/workspace GSI (**TI-20**/**TI-33**, which also bounds the MCP per-call scans in **TI-55**) · auto-backfill a new projection on deploy (**TI-17**) · wire `TodoList` into `ProjectionRebuildHandler` so it is genuinely rebuildable (**TI-57**) · run the desktop Playwright specs in CI, where today they run nowhere (**TI-53**) · make MCP tool failures diagnosable (**TI-54**) · the Command/Query Lambda naming audit, now actionable since 27-D shipped the split (**TI-34**). The [Summary table](technical-improvements.md#summary) is the full index with a status per row — scan its Status column rather than this paragraph. Phase 27 is complete (only optional RYW-D, an SSE poke channel, remains).

→ [docs/technical-improvements.md](technical-improvements.md)

## Reference docs

Not work trackers — the durable descriptions of how the system is built and why.

| Doc | What it holds |
|-----|---------------|
| [docs/adr/README.md](adr/README.md) | **The ADR index** — every architecture decision record, its status, and where it bites |
| [docs/architecture.md](architecture.md) | How the system is built *now* (ADRs say *why*) |
| [docs/event-model.md](event-model.md) | Commands and events per aggregate — updated **before** any new command is built |
| [docs/event-schemas.md](event-schemas.md) | Wire shapes for events |
| [docs/view-schemas.md](view-schemas.md) | Wire shapes for read projections |
| [docs/observability.md](observability.md) | Runbook — where to see errors, latency, a single request, a frontend crash |
| [docs/goals.md](goals.md) | What this project is for |
