# Technical Improvements

Technical, infrastructure, and developer-experience items to address in the future. These are **not user-facing features** — they're refactors, upgrades, CI/CD work, and hardening that keep the system healthy. Review this list when planning a phase or when an item becomes urgent.

For the other tracks see:
- **Features** → [docs/future-features.md](future-features.md)
- **Bugs** → [docs/phases/phase-bugs.md](phases/phase-bugs.md)
- **Minor tweaks & changes** → [docs/phases/phase-minor-changes.md](phases/phase-minor-changes.md)

Each entry records what it is, why it matters, where it was raised, and any dependency. When an item is actioned, mark it Done or remove it.

---

## Decide on a server-state library (TanStack Query / SWR) vs hand-rolled hooks — and record it

**Resolved** by [ADR 0010](adr/0010-server-state-strategy.md) (slice 14-W) — **deferred, stay hand-rolled**. The decision is to keep the hand-rolled `useEffect`-fetch + `useState` hooks for now because this repo is a learning vehicle; adopting TanStack Query / SWR would hide the server-state mechanics we want to learn. See the ADR for the rationale and the "Revisit when" triggers that would graduate a library migration to its own numbered phase.

---

## Split the monolithic `web/src/api.ts` by domain

**What:** `web/src/api.ts` is 408 lines mixing ~8 domains (notes, actions, cards, tags, folders, todos, meetings, transcription) and repeats the `if (!res.ok) throw new Error(...)` boilerplate ~34×. Split it into a per-domain folder:

| New file | Holds |
|---|---|
| `api/client.ts` | `apiFetch`, `withAuth`, `refreshOnce`, plus a `request<T>()` helper that does the `!res.ok` throw once |
| `api/notes.ts` | note + card fns (`getNoteDetail`, `createNote`, `getNoteCards`, `analyseNote`, …) + types |
| `api/actions.ts` | action-item fns + types |
| `api/tags.ts` | tag fns + `TagIndexEntry` |
| `api/folders.ts` | folder fns + `FolderNode` |
| `api/todos.ts` | todo fns + `TodoItem` |
| `api/meetings.ts` | meeting/calendar fns + types |
| `api/transcription.ts` | transcription credential/complete fns |

**No barrel `api/index.ts`** — the `frontend-react` skill forbids barrels (tree-shaking + cycles). Update call sites to import from the specific module (`import { getFolders } from '@/api/folders'`). Pure file-move + `request<T>()` extraction; no behaviour change, specs stay green.

**Why it matters:** single-domain modules read and edit cleanly; the `request<T>()` helper deletes ~34 lines of duplicated throw logic; and the per-domain split is the natural seam if the TanStack Query migration (ADR 0010) is ever reversed. Worth doing **independently** of that decision — the separation helps the hand-rolled hooks too.

**Raised in:** Frontend module-cohesion review 2026-06-04; codified as the "non-component modules stay single-domain" smell in the `frontend-react` skill.

**Depends on:** — (independent; do *before* any TanStack migration so each later slice builds on a clean per-domain file).

---

## Stricter TypeScript compiler flags beyond `strict`

**What:** `web/tsconfig.app.json` has `strict: true` but none of the strict-*family* extras. Adopt incrementally:
1. **`noUncheckedIndexedAccess`** first — makes `arr[i]` / `record[key]` typed as `T | undefined`, catching a real class of "index that isn't there" bugs `strict` lets through.
2. **`exactOptionalPropertyTypes`** later — distinguishes "absent" from "present and `undefined`".

**Why it matters:** `strict` alone still lets `arr[i]` lie about `undefined`; a mature TS codebase closes these.
**Cost:** non-trivial one-time fix backlog, especially `exactOptionalPropertyTypes`. Do `noUncheckedIndexedAccess` first as its own PR; defer `exactOptionalPropertyTypes` until the first is clean.
**Raised in:** Frontend standards research 2026-06-04 (gap vs Google TS / typescript-eslint strict family).
**Depends on:** —

---

## Frontend state-management hygiene — colocation + Context performance

**What:** Two related guidelines, currently uncodified:
1. **State colocation** — keep state nearest its consumer; lift only when siblings genuinely share it; prefer component composition (children/slots) over Context to solve prop drilling. (KCD, Bulletproof React.)
2. **Context performance audit** — memoize every provider `value` with `useMemo` (callbacks via `useCallback`), and split a context by update frequency (state vs dispatch) where it has both. An unmemoized value re-renders every consumer on each parent render; `React.memo` on a consumer does **not** block a context-driven re-render. Audit `AuthContext`, `ThemeProvider`, `ToastProvider`.

**Why it matters:** prevents whole-tree re-render cascades and over-coupling to global context as the app grows.
**Raised in:** Frontend standards research 2026-06-04 (react.dev useContext / KCD colocation).
**Depends on:** — (the context-value audit is a small concrete task; colocation is an ongoing convention — candidate to also fold into the `frontend-react` skill if it recurs in review).

---

## Core Web Vitals — bundle budget gate + CLS sizing + non-urgent transitions

**What:**
1. **Bundle-size budget that fails CI** (`size-limit` or `rollup-plugin-visualizer` threshold) — bundle size only grows silently without a hard gate. Pairs with the existing `React.lazy` code-splitting of Tiptap / transcribe-streaming.
2. **Reserve space for async/media content** (explicit width/height or `aspect-ratio`, skeletons) to avoid CLS; never lazy-load the LCP image.
3. **`useTransition` / `useDeferredValue`** for non-urgent updates (tag/note filtering, search) to keep INP low.

**Targets (field, 75th pct):** LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1. (INP replaced FID in 2024.)
**Why it matters:** these are the pass/fail bars real users are scored on; a CI budget stops silent regressions.
**Raised in:** Frontend standards research 2026-06-04 (web.dev/vitals).
**Depends on:** —

---

## Network resilience — retry transient failures with backoff

**What:** `apiFetch` does not retry. Add exponential backoff + jitter for transient failures (network error, 5xx, 429); **never** retry 4xx (won't self-heal). Scope it to idempotent GETs first.
**Why it matters:** a single transient blip currently surfaces as a hard error; naive immediate retries amplify outages, so backoff+jitter is the correct form.
**Raised in:** Frontend standards research 2026-06-04.
**Depends on:** — (revisit if/when the TanStack Query migration in ADR 0010 is reversed — the library supplies retry/backoff for free, so don't hand-roll it twice).

---

## XSS hardening — allowlist URL schemes on user-derived `href`/`src`

**What:** React auto-escapes text but **not** URL attributes. Any `href`/`src` built from user/AI-derived data (e.g. links inside note content / markdown output) must allowlist the scheme and reject `javascript:` / `data:`. Centralise in one helper alongside the planned `renderSafeHtml()` DOMPurify wrapper so the check can't be skipped ad hoc.
**Why it matters:** a `javascript:` URL in rendered note content is a stored-XSS vector the existing DOMPurify-for-HTML guardrail does not cover (it sanitises HTML bodies, not anchor hrefs in JSX).
**Raised in:** Frontend standards research 2026-06-04 (OWASP XSS).
**Depends on:** — (only bites once user/AI-derived links are rendered as anchors; not currently the case, so this is a guardrail-ahead-of-need).

---

## ESLint `jsx-a11y` (blocked on ESLint 10) + `import` rules follow-up + `@/` alias

**Status of the three originals (Phase 14):**
- **`@/` path alias** — ✅ **Done** (Phase 14-Q): `resolve.alias` in `vite.config.ts` + tsconfig `paths`.
- **Import ordering** — ✅ **Done** (Phase 14-R), but via **`eslint-plugin-import-x`** (the maintained, flat-config-native fork), NOT `eslint-plugin-import` — the latter peer-caps at ESLint 9 and the project is on **ESLint 10**. Only `import-x/order` was enabled.
- **`eslint-plugin-jsx-a11y`** — ⛔ **BLOCKED / deferred** (Phase 14-S/T): `eslint-plugin-jsx-a11y@6.10.2` peer-caps at ESLint 9, no ESLint 10 support. Forcing it via `--legacy-peer-deps` would risk the lint gate, so it was deferred.

**Remaining work (this item):**
1. **`jsx-a11y` once it supports ESLint 10** — add in `warn` mode, triage the a11y backlog, promote to `error` (the deferred 14-S/14-T). Re-check the plugin's peer range periodically, or adopt an ESLint-10-compatible a11y plugin if one emerges first.
2. **`import-x/no-unresolved` + `import-x/no-cycle`** — the original AC also named "catch unresolved/circular imports", which 14-R did not enable (needs `eslint-import-resolver-typescript` wired for the `@/` alias; `no-cycle` can be noisy). Add these on a follow-up pass.
3. **Typed-lint family — adopt `@typescript-eslint` `recommended-type-checked`** (needs `parserOptions.project` wired). Unlocks the machine-enforced half of the TS conventions just added to the `frontend-react` skill: `no-floating-promises` + `no-misused-promises` (the #1 silent async bug — un-awaited promises, async `onClick`), `no-non-null-assertion` (bans `!`), `no-explicit-any`/`no-unsafe-*`, `prefer-nullish-coalescing` + `prefer-optional-chain`. Expect a one-time backlog to clear; introduce in `warn` then promote to `error`. Note: typed lint is slower (whole-program) — keep it to `*.ts/*.tsx` and confirm CI time is acceptable.
**Why it matters:** a11y and import-hygiene enforcement turn "please remember" into "the build fails if you don't." `react-hooks` + `import-x/order` are now active; typed-lint closes the async-promise and `!`/`any` gaps; this closes the remaining gaps.
**Raised in:** Frontend standards review 2026-06-03; updated after Phase 14-Q/R/S/T (ESLint-10 plugin-ecosystem gap discovered).
**Depends on:** `jsx-a11y` shipping ESLint 10 support (external). The import rules are unblocked.

---

## Migrate `App.css` to CSS Modules

✅ **Done** (Phase 14, completed by slice 14-P, 2026-06-03). `web/src/App.css` is deleted. The `:root` tokens + every `[data-theme]` block (plus a new `--space-*` spacing scale) live in `web/src/styles/tokens.css`; reset/base-element rules in `web/src/styles/global.css`, both imported once at the app root. Every component now owns a co-located `*.module.css` with `camelCase` classes and `styles.*` references; `clsx` was added for conditional classes. Migration was shipped component-by-component across Phase 14 (14-E/F/G/H/I/J/K/L/M/N/P), regression-checked by the Vitest/RTL suite and `Browser.E2E` journeys.

> This item and **"Break down the monolithic `App.css` into a proper CSS architecture"** below describe the same work — both are now complete.

**Raised in:** Frontend standards update, 2026-06-02. Decision: CSS Modules, incremental migration with a near-term dedicated full-migration effort.

---

## Upgrade GitHub Actions to Node.js 24

✅ **Done** (2026-06-04). Every action across `deploy.yml`, `eval.yml`, and `pr.yml` was bumped to its latest node24 major: `checkout@v6`, `setup-node@v6`, `cache@v5`, `setup-dotnet@v5` (also a node20 action — added to scope), `upload-artifact@v7`, `aws-actions/configure-aws-credentials@v6`. Runtime confirmed `node24` for each via the GitHub API; major-version release notes checked for breaking changes — none affect this repo (`setup-node` auto-cache needs a `packageManager` field we don't have; aws-credentials v5 boolean-input cleanup is moot as we pass only string inputs; `checkout` v6 separate creds-file is harmless). Two non-obvious floors: `upload-artifact` needs **v6+** (v5 still defaults to node20) and `aws-credentials` needs **v6** (v5 is node20).

**Deliberately not changed:** `setup-node`'s `node-version: "20"` (the Node used to *build* the frontend) stays at 20 — that is separate from the action-runtime deprecation and is governed by the `package-lock.json`/Node-version guardrail in CLAUDE.md. Bumping the build Node is its own decision (would require regenerating the lock file on Node 24).

**Why it mattered:** Node.js 20 actions are deprecated; GitHub forces Node.js 24 by default from 2026-06-02 and removes Node 20 from runners on 2026-09-16.
**Raised in:** Phase 6 / adhoc CI observation. **Actioned:** 2026-06-04.

---

## Resolve ESLint warnings in `web/src/auth/AuthContext.tsx`

✅ **Done** (PR #172, 2026-06-04). All four repo-wide lint warnings cleared:
- `AuthContext` + `useAuth` moved into `web/src/auth/context.ts` (named `context.ts`, not `authContext.ts`, to avoid a case-collision with `AuthContext.tsx` on the case-insensitive `/mnt/c` filesystem); `AuthProvider` is now the only export of `AuthContext.tsx`, restoring Fast Refresh.
- `ToastContext` + `useToast` split out into `web/src/components/toastContext.ts` the same way.
- The one-shot OAuth-exchange `useEffect` now takes its stable `clientId`/`initialToken` deps, clearing the last `react-hooks/exhaustive-deps` warning. No behaviour change.

**Raised in:** CI annotation review, 2026-06-02 (`validate-frontend`). **Actioned:** 2026-06-04.

---

## Add `cdk synth` to the pre-commit hook

**What:** The pre-commit hook builds, lints, typechecks, and runs the test suites, but does **not** run `cdk synth`. Add it so the local gate matches the guardrail "Never commit without all BDD specs green and `cdk synth` succeeding." Note `cdk synth` requires a prior `dotnet publish` of the API, so factor that into the step.
**Why it matters:** The hook otherwise lets through commits that break CDK synthesis, which then fail later in CI/deploy.
**Raised in:** Spun off from the now-resolved stale-test-paths fix (840464b) — that change corrected the hook's project paths and removed the leftover empty test dirs, but left the `cdk synth` suggestion unactioned.
**Depends on:** Nothing blocking. Decide whether the `dotnet publish` cost is acceptable in a pre-commit gate.

---

## Split the single API Lambda into individual Lambdas (CQRS + async projectors)

**What:** The backend currently runs as one `ApiFunction` Lambda (ASP.NET minimal API behind an HTTP API proxy) that handles every route and updates all projections **synchronously in-process, inline in the command handlers** (e.g. `NoteCommandHandler.UpdateProjectionAsync`) before returning the HTTP response. Move to a deployment shape that matches an event-sourced system, in two stages:

1. **Stage 1 — CQRS + async projectors (do first).** Split write from read into separate Lambdas, and move projection-building off the request path onto **DynamoDB Streams** (or EventBridge): a **Command Lambda** appends events only; a **Projector Lambda** (idempotent, replayable) rebuilds read models off the stream; a **Query Lambda** serves reads from projections.
2. **Stage 2 — per-context command Lambdas (when ready to take it on).** Split the command surface by bounded context (Note / Folder / Calendar / Transcription / Todo) into separate Lambdas for deploy and scaling isolation and tighter per-context IAM. Adopt incrementally, only where a context earns it (e.g. Transcription's different runtime profile) — not wholesale.

The full rationale, target diagrams, staged migration plan, and the eventual-consistency trade-off are in **[ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md)**.

**Why it matters:** This is the defining event-sourcing deployment lesson for the project — an append-only log with decoupled, replayable async consumers — and it's the largest remaining ES learning surface (Streams, idempotency, replay, eventual consistency, async failure handling, DLQs/alarms). It also shrinks the write path and tightens per-Lambda IAM (today one role grants read/write on ~10 tables).

**Headline trade-off:** Stage 1 replaces today's immediate read-after-write consistency with **eventual** consistency (projector lags the write by stream latency, typically <1s). The frontend's optimistic updates already insulate the user, but server-side read-after-write — **smoke tests, E2E tests, and any read-after-append flow** — must move to retry/polling. Async projection failures also become invisible (DLQ + alarm) rather than a synchronous 500, so observability must be wired in the same slice.

**Raised in:** Architecture discussion, 2026-06-02 — desire to align the deployment with the event-sourced design.
**Depends on:** Nothing blocking. Pairs with the `observability` skill (async failure visibility). Best done as its own numbered phase given the breadth; graduate Stage 1 to a phase when picked up.

---

## Reduce Lambda SnapStart costs

✅ **Done** (2026-06-03) — investigated against prod (account 642653037268, eu-west-2) and right-sized via memory reduction.

**Findings:**
- **Version accumulation is not happening.** The version counter is at 164, but CloudFormation retains only the active version plus two May-20 orphans (42, 43); it replaces the published version on each deploy rather than piling them up. Orphan snapshots auto-expire after 14 days with no invocation, so they self-clean.
- **Cost is almost entirely snapshot-cache storage** (`SnapStart-Cached-GB-S`, ~$4–5/mo), billed per GB of `MemorySize`. Restore charges (`SnapStart-Restored-GB`) are ~$0.03/mo and per-request compute (`Lambda-GB-Second`) is ~$0 (free tier).
- **SnapStart earns its keep — kept on.** Cold starts are not rare (~10–25/day, 300+/mo) and SnapStart restores them in ~400–650 ms vs the multi-second .NET 10 cold init without it. Disabling it would save ~$50/yr but regress hundreds of requests/month.
- **The lever was memory, not versions.** The function was provisioned at 512 MB but peak `Max Memory Used` is ~165 MB (~3× over-provisioned).

**Action taken:** Dropped `ApiFunction` `MemorySize` 512 → 256 MB (~55% headroom over observed peak), roughly halving the dominant cache-storage cost *and* per-request compute. CDK assertion updated to match. Watch restore duration post-deploy — less memory means less vCPU, so if restore latency climbs materially, bump to 384 MB.

**Raised in:** Cost-review observation, 2026-06-02. Actioned 2026-06-03.

---

## Break down the monolithic `App.css` into a proper CSS architecture

✅ **Done** (Phase 14, completed by slice 14-P, 2026-06-03) — superseded by and merged into the **"Migrate `App.css` to CSS Modules"** item above. The monolith is gone: a token layer (`styles/tokens.css`, with formalised `--space-*` spacing alongside the existing `--color-*` palettes), a base layer (`styles/global.css`), and per-component scoped CSS Modules now replace the single global stylesheet. Class collisions are impossible (module scoping), and the line-number references in the planning docs no longer apply.

<details><summary>Original entry (kept for context)</summary>

**What:** `web/src/App.css` is a single **2,807-line** stylesheet that holds the styles for the entire frontend — sign-in, sidebar, folder tree, home list, note editor, to-do section, transcription UI, theme palettes (`:root` + every `[data-theme="…"]` block), notification banners, and more. Everything is global-scoped and edited by line-number reference (the doc entries throughout `phase-minor-changes.md` point at "~L821", "~L2057", etc.), which is brittle and makes it easy to clobber unrelated rules. Break it down into a maintainable structure and apply proper CSS practices. Options to weigh when picked up:
- **Split by concern into multiple files** imported from a small entry point — e.g. `tokens.css` (custom properties + theme palettes), `base.css`, and per-feature files (`sidebar.css`, `note-editor.css`, `todo.css`, `list-view.css`, `sign-in.css`, …), co-located with or near their components.
- **Move to CSS Modules** (Vite supports `*.module.css` out of the box) so each component owns scoped styles and class collisions become impossible — the biggest structural win, but the largest change.
- **Establish a token layer** as the single source of truth for colours/spacing/typography (the `--color-*` variables already exist; formalise spacing/radius/font tokens too) so feature files never hardcode values.
- Either way: introduce a consistent naming convention, group/region the rules, and remove dead/duplicated declarations found along the way.

**Why it matters:** A 2,800-line global stylesheet is a growing maintenance and correctness risk — every UI tweak risks an unintended cascade, line-number references in the planning docs rot as the file shifts, and there is no scoping to stop one feature's styles leaking into another. This is the frontend counterpart to the backend's structural hygiene; it lowers the cost and risk of every future UI slice (notably the queued home-screen tweaks CHANGE-8/9/10, which all edit this file). It is also a strong learning surface for CSS architecture (tokens, scoping strategies, CSS Modules vs. global).

**Raised in:** User request, 2026-06-02 — "review the app.css and break it down; it needs proper CSS skills."
**Depends on:** Nothing blocking. Best done as a behaviour-preserving refactor behind the existing component tests (no visual change intended) — snapshot/visual-diff or a careful manual pass to confirm nothing reskins. Sequence it **before or alongside** the home-screen tweaks (CHANGE-8/9/10) so they land on the new structure rather than the monolith. Given the breadth, consider graduating it to its own numbered phase when picked up.

</details>
