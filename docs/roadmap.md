# Roadmap

This is the index for all planned and in-progress work. Each numbered phase below has a one-paragraph summary here and a detail doc under `docs/phases/`. Work that isn't a numbered phase — bugs, minor tweaks, model/prompt improvements, future feature ideas, and technical improvements — lives in the standing docs linked from [Standing tracks and planning docs](#standing-tracks-and-planning-docs) at the bottom.

Sequence is learning-optimised: event sourcing plumbing lands in Phase 1 so every subsequent feature is an ES learning moment, not a feature grind.

## Phase 0 — Setup _(Done)_

**Goal:** every tool is wired up, hello world deployed end-to-end, first spec passes.

Slices and acceptance criteria: [docs/phases/phase-0.md](phases/phase-0.md)

## Phase 1 — Walking skeleton with event sourcing _(Done)_

- One aggregate (`Note`), two events (`NoteCreated`, `NoteRenamed`)
- Append-with-optimistic-concurrency on DynamoDB (`TransactWriteItems` + META row)
- One read projection (`NoteTitleList`) in a dedicated DynamoDB table
- React frontend on S3 + CloudFront; create and list notes end-to-end

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

- `ContentEdited` (done), `NoteDeleted`, event versioning, projection rebuild
- Event versioning learned by needing it
- Projection rebuild logic exercised

**Goal:** you've changed your mind about an event's shape at least once and survived.

Slices and acceptance criteria: [docs/phases/phase-2.md](phases/phase-2.md)

## Phase 3 — Cross-aggregate projection (todo list) _(Done)_

- `ActionItemAdded`, `ActionItemCompleted`, `ActionItemReopened`, `ActionItemDeleted`
- Projection aggregates action items across all notes into a single todo list
- Complete and delete todos from the home screen

**Goal:** the "power of projections" moment — same events, new read model.

Slices and acceptance criteria: [docs/phases/phase-3.md](phases/phase-3.md)

## Phase 4 — UX redesign (wireframe alignment) _(Done)_

Bring the app in line with the wireframes in `docs/wireframes/`.

- **4-A:** Settable note date (`NoteDateSet` event; date shown in note header and cards)
- **4-B:** Two-column note layout (content left, actions right panel, bordered content area)
- **4-C:** Implicit action add (Enter or blur submits; no Add button)
- **4-D:** Persistent note list sidebar (visible on home and note screens)
- **4-E:** Note summary cards on home screen (new `NoteCard` projection; title, date, snippet, action count)
- **4-F:** Expandable completed todos (new `GET /todos/completed` endpoint; collapse/expand toggle)

**Goal:** the app matches the design intent; projection evolution is demonstrated by `NoteCard` aggregating across multiple event types.

Slices and acceptance criteria: [docs/phases/phase-4.md](phases/phase-4.md)

## Phase 5 — Tags and folders _(Done)_

- Tag notes with free-text labels; tags appear as pills on note cards and the note screen
- `TagIndex` projection powers a filter bar on the home screen (AND/OR multi-select)
- `Folder` aggregate with full hierarchy (create, rename, delete, reparent, cascade delete)
- `FolderTree` projection; drag notes between folders; Unfiled Notes view; folder preview panel
- Note date defaults to today on creation; date input shown without redundant label
- Replaces all `localStorage`-backed prototype state with real API calls

**Goal:** second projection axis (`TagIndex`) alongside an entirely new aggregate (`Folder`); client-side filter state wired to a server projection; hierarchical read models.

Slices and acceptance criteria: [docs/phases/phase-5.md](phases/phase-5.md)

## Phase 6 — Upgrade to .NET 10 _(Done)_

- LTS → LTS upgrade from .NET 8 to .NET 10 across all 10 projects in the solution
- Package compatibility audit; fix any BCL or framework-layer breaking changes
- Update Lambda runtime constant in CDK stack (`Runtime.DOTNET_8` → `Runtime.DOTNET_10`)
- Redeploy and verify with acceptance tests and E2E browser journeys
- Measure cold start baseline; enable Lambda SnapStart; verify Init Duration eliminated

**Goal:** stay on a supported Lambda runtime; learn the .NET release cadence, AWS Lambda managed runtime lifecycle, and how to run a framework upgrade safely behind a full test suite. SnapStart teaches the Lambda version/alias deployment model and how AWS eliminates cold starts via execution environment snapshots.

Slices and acceptance criteria: [docs/phases/phase-6.md](phases/phase-6.md)

## Phase 6.5 — Frontend Component Tests _(Done)_

- Rename all six test projects to scope-descriptive names (`Domain.Specs`, `EventStore.Integration`, `Api.Integration`, `Infrastructure.Assertions`, `Api.Smoke`, `Browser.E2E`)
- Scaffold Vitest + React Testing Library + MSW as Layer 7 of the testing strategy
- Write component tests for every home screen UI behaviour; delete 4 redundant E2E journeys
- Write component tests for every note view UI behaviour; delete 8 redundant E2E journeys; trim Browser.E2E to exactly 5 kept journeys

**Goal:** replace slow Playwright tests as the primary UI regression net with fast, deterministic component tests; learn Vitest, RTL, MSW, and where in the pyramid each test layer earns its cost.

Slices and acceptance criteria: [docs/phases/phase-6.5.md](phases/phase-6.5.md)

## Phase 7 — Rich note content _(Done)_

- Replace plain textarea with TipTap WYSIWYG editor
- Headings, bold, bullet lists, and checkboxes via keyboard shortcuts
- Heading = discussion topic; one click marks it as discussed (strikethrough)
- Checkboxes for inline agenda items; Action Items panel untouched
- Content stored as markdown string in existing `ContentEditedV2` event — no new events

**Goal:** learn how to integrate a ProseMirror-based editor into a React frontend; understand markdown as a storage format and the tradeoffs of serialising structured editor state to plain text.

Slices and acceptance criteria: [docs/phases/phase-7.md](phases/phase-7.md)

## Phase 7.5 — Folder UX fixes and Lambda performance _(Done)_

- Remove vestigial sidebar note list (sidebar is folder-navigation only post-Phase 5)
- Add Unfiled Notes preview pull-out (`»` button parity with folder items)
- Fix folder preview panel — cards not showing due to stale App-level state
- Optimistic folder create/rename (eliminate disappear-then-reappear flicker)
- Fix heading sync — renaming the active folder now updates the main heading immediately
- Increase Lambda memory from 128 MB default to 512 MB — eliminates 10+ second warm latency

**Goal:** close the gap between the Phase 5 spec and its implementation; learn that optimistic UI and prop-threading decisions that aren't paired with component tests at time of writing will silently regress. Demonstrate that Lambda memory is the primary warm-latency lever once cold starts are solved by SnapStart.

Slices and acceptance criteria: [docs/phases/phase-7.5.md](phases/phase-7.5.md)

## Phase 7.8 — Production Pipeline and Note Screen UX _(Done)_

- Production deployment pipeline: `deploy-production` job promotes automatically after Test; smoke tests only against production; no E2E data mutation
- Note screen keyboard focus: cursor lands in title on open; single Tab moves to content
- Note screen save/cancel: Save disabled on empty note; Cancel prompts confirmation once any field is populated
- Drag-and-drop notes into folder slide-out panel; optimistic move with revert on failure
- Layout space review: remove 640px container cap on home screen; note content panel grows to fill available height and width
- Optimistic card state sync: lift `cards` state to `App` so title renames and folder moves update all views immediately

**Goal:** Ship a production deployment target and harden the note-screen interaction model with explicit lifecycle controls, keyboard-first focus, and drag-and-drop note filing.

Slices and acceptance criteria: [docs/phases/phase-7.8.md](phases/phase-7.8.md)

## Phase 8 — Google Sign-In (multi-user auth) _(Done)_

- Google Sign-In on the frontend (PKCE flow; ID token stored in memory)
- JWT Bearer verification in the API (Google OIDC; reject unauthenticated requests)
- `ICurrentUser` abstraction; `sub` claim replaces the hardcoded user ID throughout
- `EventMetadata.UserId` populated from the authenticated user for the first time
- CDK: `GOOGLE_CLIENT_ID` env var; `Authorization` header added to CORS allow-list

**Goal:** real authentication before Calendar integration arrives; learn Google OIDC, JWT Bearer middleware, PKCE, and multi-user data isolation while the system is still small enough to retrofit cleanly.

Slices and acceptance criteria: [docs/phases/phase-8.md](phases/phase-8.md)

## Phase 9 — Google Calendar integration + meeting notes _(Done)_

- Today's meetings surfaced on the home screen (Google Calendar pass-through, single-user refresh token)
- One-click note creation linked to a calendar event (`NoteLinkedToCalendarEvent`)
- Meeting-time browser reminder via `setTimeout` + Notifications API
- Recurring meetings: one-click note for the next scheduled occurrence
- `CalendarLinkIndex` projection keyed by external calendar event ID
- Builds on Phase 8 auth: `EventMetadata.UserId` already populated from JWT

**Goal:** first outbound HTTP from Lambda; Google OAuth2 refresh-token flow; SSM Parameter Store for secrets; extending an aggregate with a new event without touching the immutable original; a projection keyed by an external system ID.

Slices and acceptance criteria: [docs/phases/phase-9.md](phases/phase-9.md)

## Phase 10 — Transcription & high-quality analysis _(Done)_

Build a high-quality AI analysis of meeting notes — and the means to keep it high quality: better input, measurement, and a durable correction signal that feeds prompt/model refinement. Slices 10-I → 10-M were absorbed from the former Phase 13 ("Feedback capture for AI suggestions") so that building, measuring, and refining analysis quality live in one phase.

- **Core flow (done):** record audio (AWS Transcribe Streaming via STS-issued temporary credentials); `TranscriptionCompleted` persists the transcript; Amazon Bedrock (Nova Lite) analyses transcript + existing content and applies gap-filling content, tags, and action items — action items scoped to the current user; model configurable via `BEDROCK_MODEL_ID`. Analysis also runs on any note with no transcript (10-H).
- **10-E:** Auto-analysis on stop (auto-analyse switch, default ON); **10-F:** capture remote participants by mixing system/call audio
- **10-G (done):** offline analysis evaluation harness — versioned prompts (`PromptCatalog`) + LLM-as-judge scoring over fixed transcripts, gated on `RUN_BEDROCK_EVAL`; nightly `eval.yml`. `NoteAnalysisResult` now self-describes with `ModelId`/`PromptVersion`
- **10-I/10-J (done):** `TagsSuggested` event + per-user/per-tag feedback projection (suggested vs rejected)
- **10-K/10-L (done):** `ActionItemsSuggested` event + per-user feedback projection (suggested / deleted / completed)
- **10-M:** version the `*Suggested` events to stamp `modelId`/`promptVersion`, tying the correction signal to a prompt version

The feedback track (10-I → 10-L) is complete: the correction signal is durable, queryable, and rebuildable. 10-G shipped the eval harness + versioned prompts; 10-N moved the analyse path to the model-agnostic Bedrock **Converse** API, so any accessible model can be evaluated/run; 10-M stamps `modelId`/`promptVersion` onto the `*Suggested` events; 10-O shipped `analysis@v3` as the production prompt. All 15 slices (10-A → 10-O) are done.

**Goal:** first real-time streaming feature; first LLM integration; STS AssumeRole delegation; offline LLM evaluation; purely additive provenance events and projections that *classify by combining* events; event versioning to stamp prompt/model. The event model stays clean — analysis output reuses existing event types, so the domain never knows whether content came from a human or a model; the `*Suggested` events record AI provenance without mutating state.

Slices and acceptance criteria: [docs/phases/phase-10.md](phases/phase-10.md)

## Phase 11 — UI Polish _(Done)_

- Tag autocomplete: prefix and substring matching, Tab to complete, common tags by frequency, related tags by co-occurrence
- Add to-do items from the home screen: quick-capture input, optimistic add, standalone todo aggregate
- Delete blank note on cancel; adaptive note action bar (Cancel-only when blank, Save+Delete when content present)
- Token expiry and silent refresh; fix 401s on tab wake-up via `visibilitychange` + pre-flight guard
- Delete notes from home screen; fix meeting-created notes not deleted on discard

**Goal:** Make everyday interactions feel faster and more intentional. Pure-frontend slices with no new aggregates.

Slices and acceptance criteria: [docs/phases/phase-11.md](phases/phase-11.md)

## Phase 12 — Observability _(Done)_

Make the app properly observable for production using AWS-native tooling only. Today there is one Lambda log group with unstructured text logs and nothing else — no correlation IDs, metrics, traces, dashboards, alarms, or frontend visibility. This phase closes every gap, pillar by pillar.

- **12-A:** Structured logging (Lambda Powertools) + correlation IDs returned to the caller + explicit log group with retention
- **12-B:** Domain metrics via EMF (`CommandHandled`, `CommandFailed`, `EventsAppended`, `ConcurrencyConflict`, projection durations) + event-sourcing log fields (stream ID/version)
- **12-C:** Distributed tracing with AWS X-Ray (active tracing, SDK instrumentation, named subsegments, trace-ID propagation)
- **12-D:** CloudWatch Dashboard (`notetaker-ops`) including a Logs Insights "all errors" widget with a time-range picker
- **12-E:** CloudWatch Alarms + SNS email (error rate, P99 latency, concurrency-conflict spikes)
- **12-F:** Frontend monitoring via CloudWatch RUM (browser errors, Core Web Vitals, failed API calls; trace-linked to the backend)
- **12-G:** Observability runbook (`docs/observability.md`) + saved Logs Insights query definitions
- **12-H:** Unified error view — surface frontend (RUM) JS/HTTP errors on the `notetaker-ops` dashboard so backend + frontend errors share one screen

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

## Phase 19 — Frontend hardening _(In Progress)_

Close the gap between the `frontend-react` skill rules (extended in PR #173) and the actual `web/` code, and adopt the lint/compiler gates that would catch regressions automatically. A full audit on 2026-06-05 confirms the codebase is already clean on the headline rules — **0 `enum`, 0 `any`, 0 in-place state mutation, no active fetch races, no XSS sinks** — so this is hardening and consistency, not bug-fixing. Anchored by **19-A** (split the 408-line, 8-domain `api.ts` into per-domain modules behind a `request<T>()` helper, no barrel; behaviour unchanged). 19-B…19-J are proposed and need selection: typed-lint + non-null/catch cleanup, stricter TS flags, context-provider memoization, effect hygiene, accessibility (live regions + focus — the one **high-value** cluster, several mutation-failure errors are currently silent to screen readers), test-quality, network retry/backoff, bundle/CWV, and explicit Tiptap Link config. (The TanStack Query server-state migration has graduated to **Phase 20**.)

Slices and acceptance criteria: [docs/phases/phase-19.md](phases/phase-19.md)

## Phase 20 — Server-state migration to TanStack Query _(In Progress)_

Replace the hand-rolled `useEffect`-fetch + `useState` server-state hooks with **TanStack Query** (cache, dedup, retry/backoff, stale-while-revalidate, optimistic-update-with-rollback), migrating **one domain per slice** with hand-rolled and library coexisting until the last. **Reverses [ADR 0010](adr/0010-server-state-strategy.md)** (Accepted: stay hand-rolled), so the whole phase is **hard-gated** on a superseding ADR. Builds on the `api/<domain>.ts` seam from 19-A. Seven slices: **20-A** foundation + todos pilot (sets the `useQuery`/`useMutation`+rollback template), then **20-B** folders, **20-C** cards/list, **20-D** actions+tags, **20-E** note detail, **20-F** meetings, **20-G** cleanup (subsumes 19-H). Transcription credentials stay hand-rolled. **Done:** the ADR gate ([ADR 0012](adr/0012-adopt-tanstack-query-server-state.md) supersedes 0010), **20-A** (foundation + todos pilot, the template the rest copy), **20-B** (folder tree), **20-D** (actions + tag index), and **20-C** (note cards/list — the big App.tsx consolidation; needed fix #195 for a post-merge E2E regression). Remaining: 20-E (note detail), 20-F (meetings), 20-G (cleanup; also drop the now-dead `listNotes` export).

Slices and acceptance criteria: [docs/phases/phase-20.md](phases/phase-20.md)

## Phase 21 — URL routing: distinct URLs, working back/forward, shareable note links _(Done)_

The frontend has **no router** — `App.tsx` holds a single in-memory `view` union (`list` | `folder` | `note`) and opening a note is just `setView({ kind: "note", noteId })`, so the URL never changes, back/forward are no-ops, and a specific note can't be linked. This phase adopts **react-router-dom** (recorded in [ADR 0013](adr/0013-adopt-react-router-dom.md)) and maps the three surfaces — home, folder, note — to real routes (`/`, `/folders/:folderId`, `/notes/:noteId`), so back/forward work and a note or folder URL can be shared and deep-loaded. Frontend-only: no event model, API, or backend change; CloudFront already rewrites unknown paths to `index.html`. Four steps: an **ADR gate**, **21-A** (router foundation + note & home URLs — the keystone), **21-B** (folder URLs), **21-C** (deep-link edge cases: missing-note recovery, signed-out-link survival, hard-load coverage). Transient surfaces (sidebar, preview pull-out, note tabs) stay in component state.

**Goal:** client-side routing on an SPA; mapping a hand-rolled view-state union onto a declarative route table; deep-linking against an already-configured CloudFront SPA rewrite; the auth-gate-vs-route ordering problem; and the dependency tradeoff of adopting a router in a deliberately hand-rolled frontend (contrast [ADR 0010](adr/0010-server-state-strategy.md)).

Slices and acceptance criteria: [docs/phases/phase-21.md](phases/phase-21.md)

## Phase 22 — Search across notes _(Done)_

Add fuzzy free-text search across all of a user's notes from a home-screen search bar, with **no new infrastructure and no fixed cost**. A new `NoteSearchView` projection holds one searchable document per note (title, Quick notes, Final notes, tags, action-item text — **not** the raw transcript); a `GET /notes/search?q=` endpoint reads the current user's documents and **fuzzy-ranks them in-Lambda** (Levenshtein / token-set ratio), staying inside the existing DynamoDB + Lambda stack at $0 marginal cost. **22-A** builds the searchable read model + endpoint (backend-only, independently shippable); **22-B** adds the debounced as-you-type search bar (results replace the card grid, explicit no-results/error states), preceded by a throwaway UX prototype. 22-B depends on 22-A. Graduated from the "Search across notes" future-features idea.

**Goal:** build search *without* a search engine — a purpose-built read model shaped for a query and in-process fuzzy ranking over a `UserId`-scoped projection read; understand where that approach's cost/latency curve bends (linear in note count, superseded later by pagination/server-side filtering); ranking/threshold tuning as a measured concern; and the privacy discipline of never logging query text or note content.

Slices and acceptance criteria: [docs/phases/phase-22.md](phases/phase-22.md)

---

## Standing tracks and planning docs

Alongside the numbered phases above, work is tracked in five standing docs. The roadmap summarises them; each doc owns its content.

### Bugs _(Ongoing)_

An unnumbered, standing phase capturing defects in the deployed app, tracked to a fix. No learning theme, no fixed sequence.

Currently open: _(none)_. Fixed: **BUG-1** blank screen on 401 _(done 2026-06-02)_ · **BUG-2** favicon.ico 404 on page load _(done 2026-06-02)_ · **BUG-3** Data Protection cold-start log noise _(done 2026-06-02)_ · **BUG-4** ConcurrencyException → 409 _(done 2026-06-02)_ · **BUG-5** write to deleted note → 404 _(done 2026-06-02)_ · **BUG-6** CloudWatch RUM loader CDN host regional _(done 2026-06-02)_ · **BUG-8** `x-correlation-id` now emitted as the `correlation_id` log field _(done 2026-06-02)_ · **BUG-10** live transcription kept in pace — audio batched into ~100ms chunks _(done 2026-06-03)_.

→ [docs/phases/phase-bugs.md](phases/phase-bugs.md)

### Minor Changes _(Ongoing)_

An unnumbered, standing phase for small tweaks and changes to existing behaviour that don't warrant a numbered phase and aren't defects. Shipped: single-spaced note lines, theme selection, home screen shows today's notes by default, to-do rows that wrap cleanly with long text, sign-in screen visual polish, a collapsible "Filters" control for home tags, 12 colour schemes (Forest dropped as a Teal duplicate), the theme picker and Sign out always visible without scrolling, the restructured home Filters panel (Option D), the home Notes list top-aligned with Today's Meetings (divider dropped), the preview pull-out `»`/`«` reflecting whether its panel is open, a home-screen refinement pass (icon card/to-do actions, hidden tag labels, boxless filter tags, no card action lists, lighter Today's Meetings), a "Next occurrence" control inside a recurring-meeting note (parity with the home Today's Meetings affordance), and the transcription audio toggle relabelled from "Call audio" to "Record screen-share audio". Open: _(none — backlog clear)_.

→ [docs/phases/phase-minor-changes.md](phases/phase-minor-changes.md)

### Model & Prompt Improvements _(Ongoing)_

An unnumbered, standing phase for iterative improvements to the AI analysis — new `analysis@vN` prompts, model swaps, judge changes — each justified by an eval delta from the 10-G harness. Open-ended by design: as long as quality can be pushed higher, items are added, measured with `make eval`, and shipped. The [`eval-run`](../.claude/skills/eval-run/SKILL.md) skill appends the next suggested item after each run (with the user's go-ahead) and maintains the companion [`docs/eval-runs/`](eval-runs/) reports and [`test-matrix.md`](eval-runs/test-matrix.md). Currently open: **MPI-1** `analysis@v4` to deepen note content (the universal weak dimension), moved here from the former Phase 10-P.

→ [docs/phases/phase-model-prompt-improvements.md](phases/phase-model-prompt-improvements.md)

### Future Features

Possible user-facing features not yet committed to a numbered phase. When one is picked up it becomes a numbered phase here. Currently: Workspaces; expanding the to-do functionality for today and the future (due/scheduled dates with Today/Upcoming grouping); scalable note loading (pagination) with server-side filtering, which is the home of server-side folder tag search; and dynamic folders (saved tag-based views).

→ [docs/future-features.md](future-features.md)

### Technical Improvements

Technical, infrastructure, and developer-experience items to address in the future (refactors, upgrades, CI/CD, hardening). Currently: investigate whether `cdk synth` needs AWS credentials in `validate.yml`, add `cdk synth` to the pre-commit hook, make the pre-commit eslint step conditional, split the single API Lambda into CQRS write/read Lambdas with async projectors ([ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md)), and break the monolithic 2,800-line `web/src/App.css` into a proper CSS architecture (tokens + per-feature files or CSS Modules).

→ [docs/technical-improvements.md](technical-improvements.md)
