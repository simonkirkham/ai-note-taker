# Phase 19 — Frontend hardening

**Goal:** Close the gap between the `frontend-react` skill rules (extended in PR #173) and the actual `web/` code, and adopt the lint/compiler gates that would catch regressions automatically. A full audit on 2026-06-05 (four parallel scans) confirms the codebase is already clean on the headline rules — **0 `enum`, 0 `any`, 0 in-place state mutation, no active fetch races, no XSS sinks, no `<img>`/CLS risk.** So this phase is hardening and consistency, not bug-fixing: split the monolithic `api.ts`, fix a cluster of small correctness/perf/a11y/test gaps the audit surfaced, and turn the matching rules into machine-enforced lint/flags. Anchored by the `api.ts` split (19-A). Per the learning-vehicle framing, each slice is a self-contained frontend-quality lesson. **TanStack Query stays deferred per [ADR 0010](../adr/0010-server-state-strategy.md).**

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 19-A | **Split `api.ts` by domain.** 434-line, 8-domain module → `api/<domain>.ts` + a shared `request<T>()`/`requestVoid()` helper absorbing the ~33 `!res.ok` repeats; no barrel; behaviour unchanged | Done | — |
| 19-B | **Typed-lint + non-null/catch cleanup.** Adopt `@typescript-eslint` `recommended-type-checked`; remove the 8 non-null `!` and the unsafe `catch` typing; add cheap flags (`noImplicitOverride`) | Not Started | — |
| 19-C | **Stricter index/optional TS flags.** `noUncheckedIndexedAccess` then `exactOptionalPropertyTypes`, staged with backlog clear | Not Started | 19-B |
| 19-D | **Context provider performance.** Memoise `AuthContext`/`ToastContext` provider values; `useCallback` the Auth actions; optional Auth state/actions split | Done | — |
| 19-E | **Effect hygiene.** Add out-of-order guards to 3 mount-only fetches; replace 3 notify-parent-in-effect patterns | Not Started | — |
| 19-F | **Accessibility: live regions + focus.** `aria-live`/`role` on ~10 transient surfaces; 6 `:focus`→`:focus-visible`; focus management for 3 dialog/popover surfaces | Not Started | — |
| 19-G | **Test quality.** Migrate testid-heavy unit tests to role/label queries; convert remaining `fireEvent` to `userEvent` | Not Started | — |
| 19-H | **Network resilience.** Exponential-backoff retry (5xx/429/network) for idempotent requests in `apiFetch` | Done (shipped in 20-G) | 19-A |
| 19-I1 | **Lazy-load + CLS.** `React.lazy` Tiptap + dynamic-import transcribe SDK; reserved-dimension fallbacks; lazy-chunk error boundary + RUM event | Not Started | 26-A |
| 19-I2 | **CI bundle-size gate.** `size-limit` budget on the entry chunk in the `frontend` CI job | Not Started | — |
| 19-I3 | **Non-urgent transitions.** `useDeferredValue` on ListView search/filter so the input stays responsive | Done | — |
| 19-J | **URL-scheme hardening.** Configure Tiptap `Link` explicitly — allowlist `http`/`https`/`mailto`, reject `javascript:`/`data:`/`vbscript:`, add `rel="noopener noreferrer nofollow"` | Not Started | — |
| 19-K | **Adopt TanStack Query (server-state migration)** — **graduated to its own phase: [Phase 20](phase-20.md)** (7 slices, gated on reversing [ADR 0010](../adr/0010-server-state-strategy.md)). Too large for one slice. | Moved → P20 | — |

> **Only 19-A is confirmed.** 19-B…19-J are **proposed** from the 2026-06-05 audit and need selection/prioritisation before Breaker drafts each. (19-K, the TanStack Query server-state migration, has **graduated to its own [Phase 20](phase-20.md)** — it reverses an Accepted ADR and is 7 slices, too big to sit here.) None blocks the others except as noted (`19-C`→`19-B`, `19-H`→`19-A`, **`19-I1`→`26-A`** — dynamic imports need the zero-downtime frontend deploy first, else lazy chunks 404 mid-session; `19-I2`/`19-I3` carry no such dependency). **19-J, 19-I2, 19-I3 are specced (full sections below) and runnable now; 19-I1 waits on 26-A.** Value tiers below: **high** = real correctness/UX/security; **medium** = perf/maintainability; **low** = consistency/future-proofing. Because the headline rules are already clean, most slices are medium/low — do not treat the long list as a backlog of bugs.

**Learning surface:** module decomposition behind a stable import seam; typed (whole-program) ESLint and the strict-flag family; React context re-render mechanics; the fetch-race/`ignore`-flag pattern and the "you might not need an effect" refactor; ARIA live regions and focus management; Testing-Library query priority; transient-failure retry/backoff; route/feature code-splitting and bundle budgeting.

---

## Slice 19-A — Split `api.ts` by domain

**Status:** Done (PR #181, deploy #472, 2026-06-05)

**User value:** None directly (pure refactor) — maintainability and a clean seam for every later frontend slice. No behaviour change; the proof is that every existing spec stays green.

**Audit numbers (2026-06-05):** `web/src/api.ts` = **408 lines, 34 exported functions, 8 domains, 33 repetitions** of `if (!res.ok) throw new Error(...)`.

### How it works (implementation notes)

- **Per-domain split** — break `api.ts` into a folder:

  | New file | Holds |
  |---|---|
  | `api/client.ts` | `apiFetch`, `withAuth`, `refreshOnce`, `refreshInFlight`, + a `request<T>(url, init?)` helper that does the `!res.ok` throw once and returns parsed JSON |
  | `api/notes.ts` | `getNoteDetail`, `createNote`, `renameNote`, `editContent`, `listNotes`, `setNoteDate`, `deleteNote`, `getNoteCards`, `analyseNote` + types |
  | `api/actions.ts` | action-item fns + types |
  | `api/tags.ts` | `tagNote`, `untagNote`, `getTags` + `TagIndexEntry` |
  | `api/folders.ts` | folder fns + `FolderNode` |
  | `api/todos.ts` | todo fns + `TodoItem` |
  | `api/meetings.ts` | `getMeetingsForDate`, `createNoteFromMeeting`, `createNoteFromNextOccurrence` + types |
  | `api/transcription.ts` | `getTranscriptionCredentials`, `completeTranscription` + types |

- **`request<T>()` helper** absorbs the 33 `!res.ok` repeats. Preserve the per-call status carve-outs that exist today: `tagNote` tolerates `409`; `createNoteFromNextOccurrence` has a `404` branch. The helper takes an optional `okStatuses`/predicate so these stay explicit, not lost.
- **No barrel `api/index.ts`** — the `frontend-react` skill forbids barrels (tree-shaking + cycles). Update every call site to import from the specific module (`import { getFolders } from '@/api/folders'`). Grep all `from "../api"` / `from "@/api"` and rewrite.
- **Types** move with their domain functions; shared cross-domain types (if any) stay in `types.ts`.
- **Auth seam unchanged** — `apiFetch` keeps the 401 pre-flight refresh + single auth-retry exactly as today; only its file location changes.

### Scenarios

Pure refactor — no new behavioural scenarios. The behavioural contract is "unchanged", proven by the existing suite:

```
Scenario: Behaviour is unchanged after the split
  Given the api.ts split into per-domain modules
  When  the full Vitest/RTL suite and Browser.E2E journeys run
  Then  every existing spec passes with no test changes beyond import paths
```

### Acceptance criteria

- [x] `web/src/api.ts` is deleted; functions live in `web/src/api/<domain>.ts` per the table; no barrel `index.ts`
- [x] A single `request<T>()`/`requestVoid()` helper replaces the ~33 `!res.ok` repeats; `tagNote`'s 409 and `createNoteFromNextOccurrence`'s 404 carve-outs are preserved explicitly
- [x] Every call site imports from the specific module (28 static + 2 dynamic; grep clean of the old path); `tsc -b` passes
- [x] No behaviour change — full Vitest suite (34 files, 328 tests) passes with only import-path edits; `npm --prefix web run lint` and `build` green

---

## Slice 19-J — URL-scheme hardening

**Intent:** Configure the Tiptap `Link` extension explicitly — allowlist `http`/`https`/`mailto`, reject `javascript:`/`data:`/`vbscript:` — so a malicious scheme in user- or AI-derived note content can't render as a live anchor. Defense-in-depth: `NoteEditor.tsx` currently relies on StarterKit's bundled Link default, which a Tiptap upgrade could silently loosen.

**Scenarios (GWT):**
- Given note content with a `javascript:` link, When the editor renders, Then no anchor with a `javascript:` href is produced.
- Given `data:` / `vbscript:` links, When rendered, Then they are rejected (no clickable anchor).
- Given `https:` / `http:` / `mailto:` links, When rendered, Then the anchors are preserved with hrefs intact.
- Given an AI-suggested link with `javascript:`, When the note opens, Then it is neutralised on the same path as user-typed input.
- Given a pasted / programmatic `setLink` with a disallowed scheme, When applied, Then it is rejected (not only the typed-autolink path).
- Given a preserved external link, When rendered, Then it carries `rel="noopener noreferrer nofollow"`.

**Acceptance criteria:**
- `Link` added to `useEditor` extensions explicitly; StarterKit's bundled link disabled (`StarterKit.configure({ link: false })`) so it can't silently override the explicit config.
- `Link.configure` sets `protocols: ['http','https','mailto']` + an `isAllowedUri` rejecting all other schemes; covers content-load, typed-autolink, and pasted/programmatic paths.
- Preserved links carry `rel="noopener noreferrer nofollow"` and an explicit `target`.
- A vitest unit test asserts on rendered DOM: a `javascript:` link yields no `javascript:` href; an `https:`/`mailto:` link is preserved.
- No regression to legitimate linking; existing markdown round-trip / editor specs stay green.
- Optimistic-UI: N/A — static editor config, no new async mutation.

**Observability:** Client-side config; no server metric. Real risks: (1) a rejected link silently dropped with no feedback — acceptable for a security guard, but tests assert the *behaviour* so it is deliberate; (2) a config no-op if StarterKit's link is not disabled — the DOM-level test (not a config-object assertion) guards both this and a future Tiptap upgrade loosening `isAllowedUri`.

**Key files:** `web/src/components/NoteEditor.tsx` (Link config, ~`:29-50`); `web/src/__tests__/NoteEditor.test.tsx` (new); `web/package.json` (pin `@tiptap/extension-link` directly — currently transitive via StarterKit).

---

## Slice 19-I — Bundle / Core Web Vitals (split: 19-I1 / 19-I2 / 19-I3)

**Intent:** Keep field CWV in reach (LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1, 75th pct) by code-splitting the two heavy interaction-gated chunks, gating bundle size in CI, and deferring expensive list re-derivation. Split into three because it spans components + build + CI; the split also lets 19-I2/19-I3 proceed while 19-I1 waits on its deploy-strategy dependency. AWS RUM (`cwr`) already auto-collects field CWV — no web-vitals JS is added.

### 19-I1 — Lazy-load Tiptap + transcribe SDK + CLS sizing — **depends on 26-A**

**Blocked on 26-A** (zero-downtime frontend deploy): dynamic imports over today's `aws s3 sync … --delete` (`deploy.yml:200`/`:403`) would 404 lazy chunks for a session holding the old `index.html` → mid-session blank pane. Land 26-A first or together.

- Scenarios: editor chunk loads lazily behind a fixed-height fallback (no layout shift); transcribe SDK (`@aws-sdk/client-transcribe-streaming`) fetched only at recording-start, absent from the entry bundle; a failed dynamic import degrades to an error boundary (not a blank pane) and records a RUM event.
- Acceptance criteria: `NoteEditor` wrapped in `React.lazy`+`Suspense` (`NoteView.tsx:497`); transcribe SDK moved to dynamic `import()` (`useTranscription.ts:4`, gated via `RecordControl.tsx`), absent from the entry chunk; reserved min-height on both fallbacks (CLS ≤ 0.1); error boundary + `recordRumEvent("lazyChunkError", …)`; a minimal `vite:preloadError` reload handler if 26-B has not shipped. Optimistic-UI: N/A (perf).
- Observability: a failed lazy import has no surface today → the `lazyChunkError` RUM event (`web/src/rum.ts`) is the gap to close; confirm RUM web-vitals collection is enabled on the AppMonitor.
- Key files: `NoteEditor.tsx`, `NoteView.tsx:497`/`:467`, `RecordControl.tsx`, `useTranscription.ts:4`, `vite.config.ts` (manualChunks if needed), `web/src/rum.ts`.

### 19-I2 — CI bundle-size budget gate — independent

- Scenario: a PR that pushes the entry/main chunk over budget fails the `frontend` CI job, naming the offending chunk and its size vs budget.
- Acceptance criteria: add `size-limit` (+ preset) and a `size` script to `web/package.json`; run it after `npm run build` in `pr.yml`'s `frontend` job; initial budget = current entry-chunk gzip size + ~10% headroom, with the absolute numbers recorded in the PR (auditable, not a guess). The Tiptap/transcribe chunks fall out of the entry budget once 19-I1 splits them.
- Observability: the gate is the build-time regression signal, complementary to RUM's runtime field signal.
- Key files: `web/package.json`, `.github/workflows/pr.yml` (`frontend` job, ~`:100-102`).

### 19-I3 — Non-urgent transitions (ListView) — independent — **Done (PR #221)**

- ✅ Shipped: `useDeferredValue` on `query` feeds `useNoteSearch` and the filtered-card memos in `ListView.tsx` (`:70`); the `SearchBar` input updates immediately while the list re-derives off the deferred value.
- Scenario: with a long list, typing in search / toggling filters keeps the input responsive while the list re-derives.
- Acceptance criteria: `useDeferredValue` (or `useTransition`) on `query` feeding `useNoteSearch` and the `filteredCards`/`homeCards` memos in `ListView.tsx` (the one real heavy-filtered-list spot); the `SearchBar` input value updates immediately. Optimistic-UI: N/A.
- Sequencing: `ListView.tsx` is also touched by **23-D** (workspace routing / query keys) — sequence to avoid a collision if 23-D is in flight.
- Key files: `web/src/components/ListView.tsx` (~`:66-120`, `:210`).

---

## Proposed slices (from the 2026-06-05 audit)

Each lists the finding, locations, value tier, and effort. Specs are written per slice when selected.

### 19-B — Typed-lint + non-null/catch cleanup — **value: medium**
- **Non-null `!` (8 in prod source):** `main.tsx:12`, `auth/AuthContext.tsx:96` (justified), `MeetingsSection.tsx:296,324`, `TodoSection.tsx:72,87,101`, `useTranscription.ts:171`. The `TodoSection` trio clears at once by making `noteId` non-optional on the action variant of the discriminated union.
- **Unsafe error typing:** `NoteView.tsx:103` — `.catch((err: Error) => …)` asserts the rejection is an `Error`; narrow with `err instanceof Error` instead.
- **Lint/flags:** adopt `@typescript-eslint` `recommended-type-checked` (needs `parserOptions.project`) → enforces `no-non-null-assertion`, `no-floating-promises`, `no-misused-promises`, nullish/optional-chain. Add `noImplicitOverride` (zero impact — no classes in `src`). Introduce lint rules in `warn`, fix backlog, promote to `error`.
- **Effort:** moderate. Folds in the existing `recommended-type-checked` item from `technical-improvements.md`.

### 19-C — Stricter index/optional TS flags — **value: low** — depends on 19-B
- `noUncheckedIndexedAccess` (large — turns `arr[i]`/`Map.get()` into `T | undefined`, cascades through the sites the 19-B `!`s guard) then `exactOptionalPropertyTypes` (moderate). Stage one PR each; clear backlog before promoting.
- **Effort:** large. Highest-friction slice; schedule last.

### 19-D — Context provider performance — **value: medium**

**Status:** Done (PR #201, deployed to main 2026-06-09).

- `AuthContext.tsx` — provider `value` was a fresh literal each render **and** `signIn`/`signOut` were unmemoised; wrapped the actions in `useCallback` and `useMemo`'d the value.
- `ToastProvider.tsx` — callbacks already `useCallback`-stable; `useMemo`'d the value object.
- Optional Auth state/actions split **deferred** — extra consumer churn for no measured need.
- Guarded by `web/src/__tests__/ContextMemoization.test.tsx` (value + Auth action identity stable across a no-state-change re-render; fresh value on a real auth-state change).

### 19-E — Effect hygiene — **value: medium**
- **Fetch-race guards (consistency; no active race today):** add an `ignore`/`cancelled` flag to the 3 unguarded mount-only fetches — `NoteView.tsx:112` (`getTags`), `ListView.tsx:42` (`getTags`), `App.tsx:75-78` (`getFolders`+`getNoteCards`). The dep-changing fetches are already correctly guarded (`MeetingsSection.tsx:99` is the model).
- **YMNNAE — drop notify-parent-in-effect:** `RecordControl.tsx:39` & `:43` (notify parent of status/transcript in an effect), `ActionsSection.tsx:27` (push derived count to parent). Notify at the source / lift state instead.
- **Effort:** medium (the YMNNAE pieces touch hook↔parent contracts).

### 19-F — Accessibility: live regions + focus — **value: high**
- **`aria-live` gaps (~10 transient surfaces with no live region):** `ListView.tsx:133-136` (create-note error), `:138` (loading), `:238-240` (empty); `MeetingsSection.tsx:261` (loading), `:265-270` (unavailable), `:310-313` (per-meeting create error), `:273-277` (empty); `NoteView.tsx:327` (loading), `:194` (not found); `FinalNotesView.tsx:50-51` (empty); `ActionsSection.tsx:90` (empty); `FolderPreviewPanel.tsx:69` (empty). Errors → `role="alert"`, status/empty → `role="status"`. Highest value: the silent **mutation-failure** errors (ListView create, MeetingsSection create).
- **`:focus`→`:focus-visible` (6):** `ActionsSection.module.css:68`, `FolderPicker.module.css:31`, `NoteEditor.module.css:22`, `NoteView.module.css:191`, `QuickCaptureTodoInput.module.css:23`, `TagsSection.module.css:71`.
- **Dialog focus management (3 gaps):** `SessionExpiredBanner.tsx` declares `role="dialog" aria-modal` but moves no focus / no trap / no Esc / no restore (highest priority); `ShortcutsPanel.tsx` and `ListView.tsx:175-198` (CollapsibleFilters) never move focus in / restore.
- **Effort:** medium. Could sub-split into 19-F1 live-regions (high) and 19-F2 focus management (medium).

### 19-G — Test quality: role-first queries + userEvent — **value: low**
- **Query priority:** suite is `getByTestId` 314 vs role/label 160. Worst (zero role/label): `RecordControl.test.tsx` (49/0), `ShortcutsPanel.test.tsx` (15/0), `FinalNotesView.test.tsx` (33/1). Migrate buttons/headings/inputs to `getByRole`/`getByLabelText`; keep `data-testid` as the **E2E** contract (unchanged — different layer).
- **`fireEvent`→`userEvent` (36 calls, 8 files):** `TagsSection.test.tsx` (23) is ~64% of all usage — convert first. Verify non-interaction `fireEvent` (timers in `ToastProvider`/`TokenRefresh`) before converting.
- **Effort:** medium-high (mechanical but broad). Pure test churn — lowest external value.

### 19-H — Network resilience: retry + backoff — **value: medium** — depends on 19-A — **Done (shipped in 20-G)**
- ✅ Shipped as part of Phase **20-G**, not a standalone 19 slice. `api/client.ts` `apiFetch` now retries transient failures (`res.status >= 500 || === 429`, thrown network `TypeError`) with exponential backoff + full jitter, honouring `Retry-After`, capped at 3 attempts. Scoped to safe **reads** (GET/HEAD) only — writes are optimistic-with-rollback (`mutations.retry:false`), so retrying a PUT/DELETE only delays rollback and a POST retry risks a duplicate create. Auth-retry stays outside the transient loop. Each retry `console.warn`s (the latency-masking guard below).

### 19-I — Bundle / CWV — **value: medium** — ✅ **specced & split** → see **## Slice 19-I (19-I1 / 19-I2 / 19-I3)** above. 19-I3 (ListView transition) **done (PR #221)**; 19-I2 (CI gate) runnable now; 19-I1 (lazy-load) depends on 26-A.

### 19-J — URL-scheme hardening — **value: low** — ✅ **specced** → see **## Slice 19-J** above. Runnable now (no dependency).

### 19-K — Adopt TanStack Query → **see [Phase 20](phase-20.md)**
Graduated out of Phase 19. The server-state migration reverses [ADR 0010](../adr/0010-server-state-strategy.md) and breaks into 7 slices behind that ADR gate — too large for one slice. Full breakdown and the worked migration example live in `docs/phases/phase-20.md`.

---

## Out of scope (explicitly deferred)

- **DOMPurify.** No HTML-render path exists; only worth adding if `dangerouslySetInnerHTML` is ever introduced.
- **Image/CLS handling.** No `<img>` tags exist; revisit if images are added.
- **A general toast for non-error notices** — `ToastProvider` already exists; this phase only fixes the surfaces that bypass it.

---

## Observability

These are mostly refactors and config; the observable risks are narrow:

1. **19-A regression surface.** A pure refactor's only failure mode is a behavioural change slipping through — the carve-outs (`tagNote` 409, `createNoteFromNextOccurrence` 404) are the likeliest to be dropped in the `request<T>()` extraction. Guard: keep those as explicit per-call options and assert them in the existing `ApiFetch`/integration specs.
2. **19-F silent failures becoming audible.** The high-value part of 19-F is exactly the *currently-silent* mutation-failure errors (ListView/MeetingsSection create). The guard is a component test asserting the failure node carries `role="alert"` — not a metric.
3. **19-H retry hiding latency.** Backoff retries can mask a degrading backend as "slow but working". If/when EMF metrics exist for the frontend, count retries; for now, `console.warn` each retry so it's visible in DevTools rather than invisible.
4. No standalone instrumentation slice — fold the above into each slice's tests. Run the `observability-brief` skill against each selected slice when Breaker drafts its spec.
