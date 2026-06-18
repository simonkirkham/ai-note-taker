# Phase 19 — Frontend hardening

**Goal:** Close the gap between the `frontend-react` skill rules (extended in PR #173) and the actual `web/` code, and adopt the lint/compiler gates that would catch regressions automatically. A full audit on 2026-06-05 (four parallel scans) confirms the codebase is already clean on the headline rules — **0 `enum`, 0 `any`, 0 in-place state mutation, no active fetch races, no XSS sinks, no `<img>`/CLS risk.** So this phase is hardening and consistency, not bug-fixing: split the monolithic `api.ts`, fix a cluster of small correctness/perf/a11y/test gaps the audit surfaced, and turn the matching rules into machine-enforced lint/flags. Anchored by the `api.ts` split (19-A). Per the learning-vehicle framing, each slice is a self-contained frontend-quality lesson. (TanStack Query was originally deferred per ADR 0010; that ADR was **superseded by [ADR 0012](../adr/0012-adopt-tanstack-query-server-state.md)** (2026-06-05) and the migration shipped as [Phase 20](phase-20.md) — see 19-E's note.)

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 19-A | **Split `api.ts` by domain.** 434-line, 8-domain module → `api/<domain>.ts` + a shared `request<T>()`/`requestVoid()` helper absorbing the ~33 `!res.ok` repeats; no barrel; behaviour unchanged | Done | — |
| 19-B | **Typed-lint + non-null/catch cleanup.** Adopt `@typescript-eslint` `recommended-type-checked`; remove the 8 non-null `!` and the unsafe `catch` typing; add cheap flags (`noImplicitOverride`) | Done | — |
| 19-C | **Stricter index/optional TS flags.** `noUncheckedIndexedAccess` then `exactOptionalPropertyTypes`, staged with backlog clear | Rejected | 19-B |
| 19-D | **Context provider performance.** Memoise `AuthContext`/`ToastContext` provider values; `useCallback` the Auth actions; optional Auth state/actions split | Done | — |
| 19-E | **Effect hygiene.** Replaced all 3 notify-parent-in-effect patterns. #3 ActionsSection `onCountChange` (PR #285); #1/#2 RecordControl status/transcript via a `useTranscription` hook-lift into NoteView + controlled RecordControl (PR #288) | Done | — |
| 19-F1 | **Accessibility: live regions.** `role="alert"`/`role="status"` on the ~15 transient surfaces (errors/loading/empty) that lack one; high value = the silent mutation-failure errors | Done | — |
| 19-F2 | **Accessibility: focus + `:focus-visible`.** 6 bare `:focus`→`:focus-visible`; consolidate `MeetingPicker`'s redundant Esc handler into `useFocusTrap`'s `onClose`. (`SessionExpiredBanner` Esc-to-close dropped — blocking re-auth gate, no valid dismiss.) | Done | — |
| 19-F3 | **Adopt `eslint-plugin-jsx-a11y`.** Add the plugin's `recommended` ruleset to `web/eslint.config.js`, clear the backlog, gate in CI — standing guard for a11y regressions (graduated from `technical-improvements.md`) | Done | — |
| 19-G | **Test quality.** Migrate testid-heavy unit tests to role/label queries; convert remaining `fireEvent` to `userEvent` | Done | — |
| 19-H | **Network resilience.** Exponential-backoff retry (5xx/429/network) for idempotent requests in `apiFetch` | Done (shipped in 20-G) | 19-A |
| 19-I1 | **Lazy-load + CLS.** `React.lazy` Tiptap + dynamic-import transcribe SDK; reserved-dimension fallbacks; lazy-chunk error boundary + RUM event | Not Started | 26-A |
| 19-I2 | **CI bundle-size gate.** `size-limit` budget on the entry chunk in the `frontend` CI job | Done | — |
| 19-I3 | **Non-urgent transitions.** `useDeferredValue` on ListView search/filter so the input stays responsive | Done | — |
| 19-J | **URL-scheme hardening.** Configure Tiptap `Link` explicitly — allowlist `http`/`https`/`mailto`, reject `javascript:`/`data:`/`vbscript:`, add `rel="noopener noreferrer nofollow"` | Done | — |
| 19-K | **Adopt TanStack Query (server-state migration)** — **graduated to its own phase: [Phase 20](phase-20.md)** (7 slices, gated on reversing [ADR 0010](../adr/0010-server-state-strategy.md)). Too large for one slice. | Closed (→ P20, done) | — |

> **Remaining:** only **19-I1** (lazy-load; its **26-A** dependency has shipped, so it is now runnable). **19-C is Rejected** (2026-06-18) — pure low-value/high-friction type-safety future-proofing on an already-clean codebase; fixes no known bug, so deliberately not picked up. **19-K is Closed** — graduated to [Phase 20](phase-20.md), which shipped. Everything else is **Done**. 19-A/19-B/19-D/19-E/19-F1/19-F2/19-F3/19-G/19-I2/19-I3/19-J all shipped (19-E completed 2026-06-14: #3 PR #285, #1/#2 PR #288; 19-G PR #286). (19-K, the TanStack Query server-state migration, has **graduated to its own [Phase 20](phase-20.md)** — it reverses an Accepted ADR and is 7 slices, too big to sit here.) None blocks the others except as noted (`19-C`→`19-B`, `19-H`→`19-A`, **`19-I1`→`26-A`** — dynamic imports need the zero-downtime frontend deploy first, else lazy chunks 404 mid-session; `19-I2`/`19-I3` carry no such dependency). **19-J, 19-I2, 19-I3 are done (PR #223 / #224 / #221); 19-I1 waits on 26-A.** Value tiers below: **high** = real correctness/UX/security; **medium** = perf/maintainability; **low** = consistency/future-proofing. Because the headline rules are already clean, most slices are medium/low — do not treat the long list as a backlog of bugs.

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

**Status:** Done (PR #223, 2026-06-11). The one previously-unmet acceptance criterion — `@tiptap/extension-link` imported but only transitive via StarterKit, not pinned directly — was closed by CHANGE-16 (direct `^3.23.4` dependency; PR #283, 2026-06-13).

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

### 19-I2 — CI bundle-size budget gate — independent — **Done (PR #224, 2026-06-11)**

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

**Status:** Done (PR #280, deploy #573, 2026-06-13). Shipped exactly as specced: `recommendedTypeChecked` + `parserOptions.project` (app + test configs), `noImplicitOverride`, `TodoItem` discriminated union removing the 3 `useTodoMutations` `!`, `MeetingsSection` guards, 2 scoped inline disables (`main.tsx`, `AuthContext.tsx`), `.catch((err: Error))` item confirmed already-fixed and dropped.

**Intent:** Adopt `@typescript-eslint` `recommended-type-checked` so the typed lint rules (`no-non-null-assertion`, `no-floating-promises`, `no-misused-promises`, nullish/optional-chain) are enforced going forward, clear the resulting backlog, and remove the remaining non-null `!` assertions. Defense against silent `null`-deref and unhandled-rejection regressions, not a bug fix — the headline surfaces are already clean.

**Stale-audit corrections (re-grounded 2026-06-13 against `web/src/`; the 2026-06-05 numbers above are wrong — do not work from them):**

| Audit claim (2026-06-05) | Current ground truth |
|---|---|
| `.catch((err: Error) => …)` at `NoteView.tsx:103` | **Already fixed.** No `.catch` with an `Error` cast anywhere in prod source; `NoteView.tsx:112`/`:223` already use `err instanceof Error`. **Drop this work item.** |
| 8 non-null `!`; `TodoSection.tsx:72,87,101` trio | **Now 7**, and the trio **moved** to `useTodoMutations.ts:35,50,63` (`item.noteId!`). |
| `MeetingsSection.tsx:296,324` | **Moved/reduced to 2:** `MeetingsSection.tsx:260` (`m.linkedNoteId!`), `:288` (`m.recurringSeriesId!`). |
| `useTranscription.ts:171` | **Moved to `useTranscription.ts:250`** (`audioQueue.shift()!`). |
| `auth/AuthContext.tsx:96` (justified) | **Moved to `:113`** (`getExp(idToken!)`), justified by the guard at `:109` — keep, suppress inline. |
| `main.tsx:12` | **Moved to `main.tsx:35`** (`getElementById('root')!`) — keep, suppress inline. |

**TodoSection trio fix:** `TodoItem` (`web/src/api/todos.ts`) types `noteId: string | null` flat across both variants; the `item.type === "action" ? action(item.noteId!, …)` ternaries assert non-null. Convert `TodoItem` to a **discriminated union** on `type` (`"action"` variant: `noteId: string`; `"todo"` variant: `noteId: null`/omitted); narrowing then removes all three `!` with no behaviour change.

**Pre-existing state to build on (do not re-introduce):** `typescript-eslint@^8.61.0` already a dep; `eslint.config.js` already extends `tseslint.configs.recommended` + jsx-a11y (19-F3) + prettier, but **no `parserOptions.project`** yet (required for type-checked); `tsconfig.app.json` is `strict: true` but lacks `noImplicitOverride`; CI lint (`pr.yml`, Node 24) runs `eslint .` as a hard gate plus typechecks against both `tsconfig.app.json` and `tsconfig.test.json`.

**Scenarios (GWT):**
- Given `recommended-type-checked` with `parserOptions.project`, When `npm run lint` runs, Then it type-resolves with no "file not included in project" parser error.
- Given the `TodoItem` discriminated union, When `item.type === "action"`, Then `item.noteId` is `string` and the three `useTodoMutations` `!` are gone.
- Given `MeetingsSection`'s open/lookup paths, When `linkedNoteId`/`recurringSeriesId` is absent, Then the code narrows (guard/early-return) rather than asserting `!`.
- Given the 2 kept `!` (`main.tsx:35`, `AuthContext.tsx:113`), When linted under `no-non-null-assertion`, Then each carries a scoped inline disable with a justification.
- Given the full backlog (floating/misused promises, nullish/optional-chain), When the slice lands, Then every typed rule is at `error` and `npm run lint` is green (each finding fixed or scoped-disabled with a one-line reason).

**Acceptance criteria:**
- `eslint.config.js` extends `recommendedTypeChecked` with `languageOptions.parserOptions.project` (+ `tsconfigRootDir`) resolving both `src` and test sources; new typed rules introduced as `warn`, backlog cleared, then **flipped to `error` before the PR opens** — final state all-`error`, no lingering `warn`.
- All 3 `useTodoMutations.ts` `!` removed via the `TodoItem` union; both `MeetingsSection.tsx` `!` removed via guards.
- The 2 kept `!` each carry a scoped `// eslint-disable-next-line @typescript-eslint/no-non-null-assertion` + justification; no file-wide or repo-wide disable.
- `noImplicitOverride: true` in `tsconfig.app.json`.
- The `.catch((err: Error))` item is **dropped** (already fixed); PR description states this.
- `npm run lint`, `tsc -p tsconfig.app.json --noEmit`, **and** `tsc -p tsconfig.test.json --noEmit` all green on Node 24; all existing vitest specs stay green. Update any test fixture that constructs a `TodoItem` literal (grep first).
- Optimistic-UI: N/A — lint/type configuration only, no new async mutation.

**Observability:** Build-time only; no production signal. Risk: a typed rule left at `warn` is a silent no-op in CI (gate fails only on `error`) — the warn→error flip is mandatory. Risk: mis-scoped `parserOptions.project` fails `eslint .` on the test sources — verify lint locally against `tsconfig.test.json`'s includes, not only the app config.

**Key files:** `web/eslint.config.js`, `web/tsconfig.app.json`, `web/src/api/todos.ts`, `web/src/hooks/useTodoMutations.ts`, `web/src/components/MeetingsSection.tsx`, `web/src/main.tsx`, `web/src/auth/AuthContext.tsx`, plus backlog files surfaced by the new rules. **Cross-ref:** folds in the standing `recommended-type-checked` item from `technical-improvements.md`; **19-C depends on this landing first.**

### 19-C — Stricter index/optional TS flags — **value: low** — **Rejected (2026-06-18)**
- **Rejected:** pure type-safety future-proofing on an already-clean codebase (Phase 19's premise). Fixes no known bug and changes nothing user-visible; the doc itself rated it large/highest-friction/schedule-last. Deliberately not picked up — preventative-only cost not justified now. Revisit only if undefined-from-lookup bugs actually surface.
- (Original scope, for reference:) `noUncheckedIndexedAccess` (large — turns `arr[i]`/`Map.get()` into `T | undefined`, cascades through the sites the 19-B `!`s guard) then `exactOptionalPropertyTypes` (moderate). Stage one PR each; clear backlog before promoting.

### 19-D — Context provider performance — **value: medium**

**Status:** Done (PR #201, deployed to main 2026-06-09).

- `AuthContext.tsx` — provider `value` was a fresh literal each render **and** `signIn`/`signOut` were unmemoised; wrapped the actions in `useCallback` and `useMemo`'d the value.
- `ToastProvider.tsx` — callbacks already `useCallback`-stable; `useMemo`'d the value object.
- Optional Auth state/actions split **deferred** — extra consumer churn for no measured need.
- Guarded by `web/src/__tests__/ContextMemoization.test.tsx` (value + Auth action identity stable across a no-state-change re-render; fresh value on a real auth-state change).

### 19-E — Effect hygiene — **value: medium**

**Status:** **Done.** #3 (PR #285, deploy #576, 2026-06-13); #1/#2 (PR #288, deploy #587, 2026-06-14).

> **Scope split (2026-06-13 → resolved 2026-06-14).** #3 (ActionsSection `onCountChange`) shipped first. #1/#2 (RecordControl `status`/`transcript`) were split out because the spec's "parent reads its own `useTranscription` instance, same cache key → same request" is **false** — `useTranscription` is a **stateful streaming hook** (owns the Transcribe client, audio worklet, credentials via `useState`/`useRef`), **not** a React Query read. A second `useTranscription(noteId)` instance would start a **second independent recording session**, not dedupe. Only React-Query-backed reads (`useActions`/`useTags`/…) dedupe across instances on a shared key. #1/#2 shipped (PR #288) by **lifting `useTranscription` up into `NoteView`** (single instance) and passing the hook result **down** to `RecordControl` (now a controlled component via a `transcription: UseTranscriptionResult` prop). Removed both upward callbacks + their effects (RecordControl 3 effects → 1). Bonus fix: the live transcript now correctly clears at `idle`/`error` (the old effect-pushed state retained stale text). See [`docs/learnings/phase-19e-effect-hygiene.md`](../learnings/phase-19e-effect-hygiene.md).

**Intent:** Remove "you-might-not-need-an-effect" (YMNNAE) effects that mirror a child's hook value into the parent via a callback fired from `useEffect`. Lift the source-of-truth state so the parent reads it directly; delete the notify-parent-in-effect indirection and its callback props. **Behavioural cleanup only — no user-visible change.**

**#3 (shipped):** `ActionsSection` no longer pushes `actions.length` up via an `onCountChange` effect; `NoteView` reads the count from its own `useActions(noteId)` query — same `keys.actions(noteId)` cache key, so React Query serves both subscribers from one fetch (no extra request, `clearLatestToken` consistency-token still consumed exactly once). Guard test: `NoteView.test.tsx` "action items loading reveals Save and Delete".

> **Audit correction — fetch-race half is DROPPED.** The 2026-06-05 race-guard targets no longer exist: `getTags`/`getFolders`/`getNoteCards` all migrated to React Query hooks (`useTags`/`useFolders`/`useNoteCards`) after **ADR 0010 was superseded by [ADR 0012](../adr/0012-adopt-tanstack-query-server-state.md)** (2026-06-05). React Query owns request cancellation/staleness, so the "consistency/defense, no live bug" race-guard work has no remaining target. The doc header's "TanStack Query stays deferred per ADR 0010" is stale. **This slice is now purely the YMNNAE cleanup** — the higher-value half of the original scope.

**YMNNAE targets (verified against current code):**

| # | Effect | Pushes to parent | Source of truth | Refactor |
|---|---|---|---|---|
| 1 | `RecordControl.tsx:59-61` | `status` → `onStatusChange` | `useTranscription(noteId)` | Parent reads `status` from its own hook; drop `onStatusChange` |
| 2 | `RecordControl.tsx:63-67` | `transcript` (gated requesting/recording/stopped) → `onTranscriptChange` | `useTranscription(noteId)` | Lift alongside #1; drop `onTranscriptChange`; preserve the status-gate at the read site |
| 3 | `ActionsSection.tsx:30-32` | `actions.length` → `onCountChange` | `useActions(noteId)` query | Parent reads count from its own `useActions(noteId)` (same cache key, no extra fetch); drop `onCountChange` |

**Parent contract to delete:** `NoteView.tsx` local state `recordingStatus`/`liveTranscript`/`actionCount` fed only by these callbacks (`:74,:76,:77`); call sites `<RecordControl onTranscriptChange={…} onStatusChange={…}>` (`:511-517`) and `<ActionsSection onCountChange={…}>` (`:584`). Downstream consumers that must keep working unchanged: `isRecording`, `displayedTranscript`, `hasContent`.

**Scenarios (GWT):**
- Given a note open, When `useTranscription` reports `status = "recording"`, Then `NoteView`'s `isRecording` UI updates and **no `onStatusChange` prop exists** on `RecordControl`.
- Given a recording in progress, When `transcript` updates, Then `displayedTranscript` shows live text; And when `status = "idle"` the live transcript is not surfaced (gate preserved); And **no `onTranscriptChange` prop exists**.
- Given a note with N open actions via `useActions`, When the section renders, Then `hasContent` reflects `count > 0` read directly; And **no `onCountChange` prop exists** on `ActionsSection`.
- Given any of the above mounted, When the component unmounts mid-recording/mid-load, Then no warning fires and no callback runs after unmount.
- Then `grep onStatusChange|onTranscriptChange|onCountChange` over `web/src/` returns zero matches.

**Acceptance criteria:**
- The 3 effects (`RecordControl.tsx:59-61`, `:63-67`, `ActionsSection.tsx:30-32`) deleted.
- `onStatusChange`/`onTranscriptChange`/`onCountChange` props removed from the components **and all `NoteView` call sites in the same commit** (CLAUDE.md shared-callback-signature guardrail).
- `NoteView` derives `recordingStatus`/`liveTranscript`/`actionCount` from `useTranscription`/`useActions` directly — no duplicate fetch (same React Query cache key → same request).
- `isRecording`/`displayedTranscript`/`hasContent` behaviour preserved exactly, including the transcript status-gate.
- Each scenario unit-tested via RTL (the YMNNAE parts are directly testable — parent receives the value on the triggering action, no effect round-trip).
- `tsc -p tsconfig.test.json` + `npm run lint` (set-state-in-effect rule) green; net `useEffect` count drops by 3; no new effect introduced.
- Optimistic-UI: N/A — pure refactor, no new async mutation.

**Observability:** None. No new failure mode, network call, or user-visible behaviour; existing transcription/action instrumentation untouched.

**Key files:** `web/src/components/RecordControl.tsx`, `web/src/components/ActionsSection.tsx`, `web/src/components/NoteView.tsx`; `web/src/hooks/useTranscription.ts`/`useActions.ts` (read-only — confirm cache-key sharing); tests `RecordControl.test.tsx`, `ActionsSection.test.tsx`, `NoteView.test.tsx`.

### 19-F1 — Accessibility: live regions — **value: high**

**Status:** Done (PR #229, deploy #518, 2026-06-11)

**Intent:** Make currently-silent transient surfaces audible to assistive tech. Errors get `role="alert"` (assertive); loading/empty/status get `role="status"` (polite). Highest value: the **silent mutation-failure** errors a screen-reader user gets no feedback on today (create-note, per-meeting create, add-todo).

**Ground-truth gaps (re-audited 2026-06-11 — several 2026-06-05 surfaces already fixed):**

| File | Surface | Type | Role to add |
|---|---|---|---|
| `ListView.tsx` | create-note error | error | `alert` |
| `ListView.tsx` | loading (folder/home) | loading | `status` |
| `ListView.tsx` | empty (home notes) | empty | `status` |
| `MeetingsSection.tsx` | loading | loading | `status` |
| `MeetingsSection.tsx` | calendar unavailable | error | `alert` |
| `MeetingsSection.tsx` | empty (no meetings) | empty | `status` |
| `MeetingsSection.tsx` | per-meeting create error | error | `alert` |
| `NoteView.tsx` | not found | error | `alert` |
| `NoteView.tsx` | loading (detail) | loading | `status` |
| `FinalNotesView.tsx` | empty (no final notes) | empty | `status` |
| `ActionsSection.tsx` | empty | empty | `status` |
| `FolderPreviewPanel.tsx` | empty | empty | `status` |
| `QuickCaptureTodoInput.tsx` | add-todo error | error | `alert` |
| `TranscriptTab.tsx` | listening status | status | `status` |
| `TranscriptTab.tsx` | empty (no transcript) | empty | `status` |

Already correct (do not touch): `ListView` search status/error/no-results, `FinalNotesView` generate error, `NoteView` no-next-occurrence, `RecordControl` errors, `ToastProvider`, `TodoSection` (section-level `aria-live`).

**Scenarios (GWT):**
- Given a create-note request fails in ListView, When the error renders, Then it carries `role="alert"`.
- Given a per-meeting create fails in MeetingsSection, When the error renders, Then it carries `role="alert"`.
- Given an add-todo request fails in QuickCaptureTodoInput, When the error renders, Then it carries `role="alert"`.
- Given the calendar is unavailable, When MeetingsSection renders the message, Then it carries `role="alert"`.
- Given a list/detail is loading or an empty state shows, When it renders, Then it carries `role="status"`.

**Acceptance criteria:**
- Every surface in the table above carries the listed role (`alert` for errors, `status` for loading/empty/status).
- A vitest test per high-value mutation-error surface (ListView create, MeetingsSection create, QuickCaptureTodoInput add) asserts the failure node has `role="alert"`, queried via `getByRole("alert")`.
- Loading/empty roles asserted where a test already renders that state; no test added purely to cover a static empty string.
- No visual change; existing specs stay green; `lint` + `tsc` green.
- Optimistic-UI: N/A (no new async mutation; only annotates existing error nodes).

**Key files:** the 8 components in the table + their `__tests__`.

### 19-F2 — Accessibility: focus + `:focus-visible` — **value: medium**

**Status:** Done (PR #234, deploy #523, 2026-06-11)

**Intent:** Stop keyboard-focus rings showing on mouse click (use `:focus-visible`), and consolidate Esc-to-close into the shared focus trap where it applies. Most dialog focus management is **already done** via the shared `useFocusTrap` hook (#211) — `SessionExpiredBanner`/`MeetingPicker` already move focus in, trap, and restore; `ShortcutsPanel` and ListView filters are correctly non-modal (no trap needed).

**Ground-truth gaps (re-audited 2026-06-11):**
- 6 bare `:focus` selectors: `ActionsSection.module.css:68`, `FolderPicker.module.css:31`, `NoteEditor.module.css:59`, `NoteView.module.css:275`, `QuickCaptureTodoInput.module.css:23`, `TagsSection.module.css:71`.
- `MeetingPicker.tsx` has a manual `document`-level Esc handler (`:54-58`) redundant with the trap's `onClose`; collapse it into the trap.

**Scope correction (during 19-F2 implementation):** the original spec proposed adding **Esc-to-close to `SessionExpiredBanner`** — **dropped, deliberately.** `App.tsx:71` renders it as a *full-screen blocking re-auth gate* (`if (sessionExpired) return <SessionExpiredBanner onSignIn={signIn} />`) with **no dismiss action** — only "Sign in again". Per the ARIA APG, Esc-to-close is *optional* and is the wrong behaviour for a dialog where dismissing is not a valid choice: the session is already dead, so Esc would only hide the one path back. Its existing focus-trap (focus-in + restore) is correct and untouched.

**Scenarios (GWT):**
- Given the meeting picker is open, When the user presses Esc, Then it closes (via the trap's `onClose`) — its existing close-on-Esc test stays green.
- Given a focusable input, When focused by mouse click, Then no focus ring shows; When focused by keyboard, Then the ring shows.

**Acceptance criteria:**
- All 6 `:focus` selectors become `:focus-visible` (the 6 files above); no other selector changed.
- `MeetingPicker`'s manual Esc handler removed in favour of `useFocusTrap(ref, { onClose })`; its existing close-on-Esc + focus-trap tests stay green.
- `SessionExpiredBanner` unchanged (Esc-to-close intentionally not added — see scope correction).
- Optimistic-UI: N/A (static config).

**Key files:** the 6 `*.module.css`, `SessionExpiredBanner.tsx`, `MeetingPicker.tsx`, `hooks/useFocusTrap.ts` (reference), relevant `__tests__`.

### 19-F3 — Adopt `eslint-plugin-jsx-a11y` — **value: medium** — graduated from `technical-improvements.md`

**Status:** Done (PR #236, deploy #526, 2026-06-11). Plugin caps its eslint peer at v9; resolved with a scoped `package.json` `overrides` pinning jsx-a11y's eslint peer to the root eslint (not a repo-wide `legacy-peer-deps`). 12-violation backlog triaged: App sidebar scrim genuinely fixed with `aria-hidden`; the rest are documented scoped disables. The gate retroactively caught `WorkspaceSwitcher` `autoFocus` (merged in parallel after the slice branch point), fixed forward in deploy #526.

**Intent:** Add a standing lint gate so accessibility regressions are caught in CI, not by hand. Graduates the "ESLint `jsx-a11y`" item out of `technical-improvements.md`.

**Scope honesty:** `jsx-a11y` would **not** have caught 19-F1's gaps — it has no "dynamic content needs a live region" rule. It catches a *different* class: missing `alt`, label/control association, redundant roles, `no-noninteractive-element-to-interactive-role`, click-without-keyboard, anchor-is-valid. So it complements 19-F1/F2, it does not replace them. (It *will* lint the `<li role="status">` in `FolderPreviewPanel` under `no-redundant-roles` — confirm that rule's verdict and either keep with an inline disable + comment, or restructure, when the backlog is cleared.)

**Scenarios (GWT):**
- Given the jsx-a11y `recommended` ruleset is enabled, When `npm run lint` runs, Then it reports any a11y violations in `web/src`.
- Given the existing backlog is fixed, When CI runs the `frontend` lint step, Then it passes with jsx-a11y active.

**Acceptance criteria:**
- Add `eslint-plugin-jsx-a11y` and its `recommended` (flat-config) rules to `web/eslint.config.js`.
- Triage the surfaced backlog: fix genuine issues; for any deliberate exception (e.g. the `FolderPreviewPanel` redundant-role), use a scoped inline disable **with a one-line justification**, never a blanket rule-off.
- `npm run lint` green locally and in CI with the plugin active.
- Optimistic-UI: N/A (lint config).
- Node-version guardrail: confirm `node --version` matches CI (Node 20) before committing the regenerated `package-lock.json`.

**Key files:** `web/eslint.config.js`, `web/package.json` / `package-lock.json`, plus whatever components the backlog surfaces.

### 19-G — Test quality: role-first queries + userEvent — **value: low**

**Status:** Done (PR #286, deploy #586, 2026-06-14). Migrated RecordControl/FinalNotesView/ShortcutsPanel from `getByTestId` to role/label-first queries (testids kept only for role-less decorative/content nodes); converted TagsSection interaction `fireEvent`s (change/blur) to `userEvent`, leaving the specific-key `keyDown`s, the mousedown-submit pair, and the unfocused-blur case as raw `fireEvent`. 71→71 tests, zero component-source changes, zero `data-testid` removed (E2E contract preserved).

**Intent:** Convert the worst unit-test query/interaction offenders from `getByTestId` to role/label-first queries and from `fireEvent`-click to `userEvent`, so unit tests assert through the accessibility tree (catching the a11y regressions 19-F1 guards) and exercise realistic interactions. Pure test churn — lowest external value; scoped to a concrete bounded target, not a whole-suite sweep.

**Ground-truth re-audit (2026-06-13 — numbers shifted from 2026-06-05):**

| Metric | 2026-06-05 | Current |
|---|---|---|
| `getByTestId`/`getAllByTestId` | 314 | **296** |
| `getByRole`/`getByLabelText`/`getByText` | 160 | **200** |
| `fireEvent` calls | 36 | **68** (audit understated ~2×) |

**Worst offenders (role/label-zero — confirmed, the right targets):** `RecordControl.test.tsx` (testid **69**, role/label 0); `FinalNotesView.test.tsx` (**22**, 0); `ShortcutsPanel.test.tsx` (**11**, 0). (`NoteView`/`MeetingsSection` have more testids but already carry role/label queries — not targets.)

**`fireEvent` — biggest is `TagsSection.test.tsx` (24, mixed change/blur/mouseDown/click + keyDown).** Deliberate non-interaction `fireEvent` to **leave untouched**: `ImageNodeView.test.tsx` (11, window drag `mouseDown/Move/Up`), `FolderPreview.test.tsx` (drag `dragOver/leave/drop`), `TokenRefresh.test.tsx` (synchronous timer click — commented), `ToastProvider.test.tsx` (`act`/timer click). userEvent (`@testing-library/user-event@^14.6.1`) already a dep.

**E2E testid contract (warning — this slice changes UNIT tests only):** `tests/Browser.E2E` references **96 `GetByTestId`** locators + 6 `[data-testid=` selectors. Migrating a unit test off a testid does **not** authorise removing that `data-testid` from component source.

**Scenarios (GWT):**
- Given `RecordControl.test.tsx`/`FinalNotesView.test.tsx`/`ShortcutsPanel.test.tsx`, When querying a button/heading/input/link with an accessible name, Then it resolves via `getByRole`/`getByLabelText` (not `getByTestId`), assertions identical, suite green.
- Given `TagsSection.test.tsx`, When a test performs a click/text-entry/blur, Then it uses `userEvent` (`await user.click`/`type`/`tab`); specific-key `keyDown` assertions may stay raw.
- Given any migrated test, When it runs, Then behaviour-coverage is unchanged — same scenarios, same assertions, same passing count.
- Given the deliberate non-interaction `fireEvent` (drag/timer), When this slice runs, Then they are left untouched.

**Acceptance criteria:**
- The 3 role/label-zero files migrated to role/label-first where an accessible name/role exists; testids retained only where no role equivalent exists.
- `TagsSection.test.tsx` interaction `fireEvent` (the ~10 non-`keyDown` of its 24) converted to `userEvent` with `userEvent.setup()` per test, `async`/`await` each interaction.
- Exclusions left untouched: `ImageNodeView` drag, `FolderPreview` drag, `TokenRefresh`/`ToastProvider` timer clicks (converting would break the timer/drag semantics they test).
- Behaviour-coverage guard: no scenario removed, no assertion weakened; **same passing-test count before and after** (Hawk checks the delta is zero).
- `git diff` touches only `*.test.tsx`; **zero changes under component source and zero `data-testid` removed** (grep-confirm no E2E-contract testid deleted).
- Optimistic-UI: N/A — test-only churn.

**Observability:** N/A — unit-test-only; no runtime surface. The value is a *test-time* signal: role/label queries fail when a component loses its accessible name (the regression 19-F1 guards), which a testid query would silently pass.

**Key files:** migrate `web/src/__tests__/RecordControl.test.tsx`, `FinalNotesView.test.tsx`, `ShortcutsPanel.test.tsx` (queries) + `TagsSection.test.tsx` (userEvent); do **not** touch `ImageNodeView.test.tsx`, `FolderPreview.test.tsx`, `TokenRefresh.test.tsx`, `ToastProvider.test.tsx`; preserve all `tests/Browser.E2E/**` testid locators.

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
