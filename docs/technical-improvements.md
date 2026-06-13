# Technical Improvements

Technical, infrastructure, and developer-experience items to address in the future. These are **not user-facing features** — they're refactors, upgrades, CI/CD work, and hardening that keep the system healthy. Review this list when planning a phase or when an item becomes urgent.

For the other tracks see:

- **Features** → [docs/future-features.md](future-features.md)
- **Bugs** → [docs/phases/phase-bugs.md](phases/phase-bugs.md)
- **Minor tweaks & changes** → [docs/phases/phase-minor-changes.md](phases/phase-minor-changes.md)

Each entry records what it is, why it matters, where it was raised, and any dependency. **The Summary table below is the at-a-glance index — scan its Status column for what's outstanding, and keep that cell in sync when an item is actioned** (the detailed section for each item carries the full status + history).

## Summary

Status key: 🔲 **Open** · 🟡 **Partly done / mitigated** · ✅ **Done** (graduated to a phase, or actioned in place). Outstanding work is every 🔲 and 🟡 row.

| ID    | Item                                                                           | Status                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| TI-1  | Decide on a server-state library (TanStack/SWR) vs hand-rolled                 | ✅ Done — ADR 0010 (stay hand-rolled)                                                                                                   |
| TI-2  | Stricter TypeScript compiler flags beyond `strict`                             | ✅ Done — → Phase 19 (19-B/19-C)                                                                                                        |
| TI-3  | Frontend state-management hygiene — colocation + Context perf                  | 🟡 Partly — Context perf done (19-D); **colocation Open** (ongoing convention)                                                          |
| TI-4  | Core Web Vitals — bundle budget + CLS + transitions                            | ✅ Done — → Phase 19 (19-I)                                                                                                             |
| TI-5  | Network resilience — retry transient failures with backoff                     | ✅ Done — 20-G                                                                                                                          |
| TI-6  | XSS hardening — allowlist URL schemes on `href`/`src`                          | ✅ Done — → Phase 19                                                                                                                    |
| TI-7  | ESLint `jsx-a11y` + `import` rules + `@/` alias                                | 🟡 **Partly** — `@/` alias, `import-x/order`, **jsx-a11y (19-F3)** done; `import-x/no-unresolved`/`no-cycle` + typed-lint (19-B) remain |
| TI-8  | Migrate `App.css` to CSS Modules                                               | ✅ Done — 14-P                                                                                                                          |
| TI-9  | Upgrade GitHub Actions to Node.js 24                                           | ✅ Done                                                                                                                                 |
| TI-10 | Resolve ESLint warnings in `AuthContext.tsx`                                   | ✅ Done — #172                                                                                                                          |
| TI-11 | Add `cdk synth` to the pre-commit hook                                         | ✅ Done — #208                                                                                                                          |
| TI-12 | Split the single API Lambda (CQRS + async projectors)                          | ✅ Done — → Phase 27 (Stage 1)                                                                                                          |
| TI-13 | Reduce Lambda SnapStart costs                                                  | ✅ Done                                                                                                                                 |
| TI-14 | Break down the monolithic `App.css`                                            | ✅ Done — 14-P (merged into the CSS-Modules migration)                                                                                  |
| TI-15 | Add a shared modal focus-trap utility                                          | ✅ Done — #211                                                                                                                          |
| TI-16 | Make the projection-rebuild endpoint robust                                    | ✅ Done — → Phase 24                                                                                                                    |
| TI-17 | Auto-backfill a new projection on deploy                                       | 🔲 **Open** — unblocked now P24 is done; pairs with Phase 23                                                                            |
| TI-18 | Rebuild emits delete tombstones for `NoteSearchView`                           | ✅ **Done** — Phase 24-B upsert-and-reconcile prunes deleted notes + hard-deletes stale tombstones                                       |
| TI-19 | Stabilise the flaky `TagsJourney` E2E                                          | ✅ Done — BUG-17                                                                                                                        |
| TI-20 | `WorkspaceList` reads via full table Scan, not a per-user GSI                  | 🔲 **Open** — fold into Phase 23                                                                                                        |
| TI-21 | CI pipeline hygiene — skip no-op deploys, cancel superseded, cache Playwright  | ✅ Done                                                                                                                                 |
| TI-22 | Skip backend publish + `cdk deploy` on frontend-only pushes                    | ✅ Done — `detect-changes` gate (2026-06-11)                                                                                            |
| TI-23 | Generalise append-retry-on-conflict beyond `NoteCommandHandler`                | 🔲 **Open** — only if a 2nd handler needs it                                                                                            |
| TI-24 | `deploy-production` hangs at "Configure AWS credentials"                       | 🟡 Mitigated — `timeout-minutes` shipped (#222); **root cause Open**                                                                    |
| TI-25 | Add a `NoteEditor` component test for the image-ordering invariant             | 🔲 **Open** — guards the 25-B regression below the E2E gate                                                                             |
| TI-26 | Zero-downtime deployments — frontend stale-chunk 404s; backend canary/rollback | ✅ Done — → Phase 26                                                                                                                    |
| TI-27 | Frontend build Node 20 → 24 + lockfile regen (dep-audit T1)                    | ✅ Done — #237, deploy #528                                                                                                             |
| TI-28 | ASP.NET 10 servicing + AWS SDK patch bumps (dep-audit T7)                      | ✅ Done — #241, deploy #530                                                                                                             |
| TI-29 | Vite 5 → 7 + Vitest 2 → 4 (dep-audit T2)                                       | ✅ Done — #245, deploy #535 (held at Vite 7; Vite 8 now GA = future)                                                                    |
| TI-30 | React 18 → 19 (dep-audit T3)                                                   | ✅ Done — #246, deploy #536 (zero code changes)                                                                                         |
| TI-31 | TypeScript 5.6 → 6.0 (dep-audit T4)                                            | ✅ Done — #249, deploy #539 (dropped deprecated `baseUrl`)                                                                              |
| TI-32 | Prime the ASP.NET pipeline before the SnapStart snapshot (first-request ~7 s)   | 🟡 **In progress** — `RegisterBeforeSnapshot` priming hook shipped on branch; pairs with TI-35. Verify post-deploy X-Ray              |
| TI-33 | `NoteCardList` reads via full-table `Scan` + `ConsistentRead`, not a GSI/Query  | 🔲 **Open** — same anti-pattern as TI-20; ~840 ms at 234 rows, scales O(all notes); fold into Phase 23                                    |
| TI-34 | Make Lambda naming specific & correct everywhere                                | 🔲 **Open** — naming audit; user-raised 2026-06-12. **API Lambda** / **Projector Lambda** now; **Command/Query Lambda** only at 27-D    |
| TI-35 | ReadyToRun-publish the API Lambda (AOT-precompile to cut first-request JIT)     | 🟡 **In progress** — `-r linux-x64` + conditional `PublishReadyToRun` shipped on branch; pairs with TI-32. Verify post-deploy X-Ray   |

**Outstanding (6 Open + 5 in-flight/Partly):** TI-17 Auto-backfill projection on deploy; TI-20 `WorkspaceList` GSI; TI-23 Generalise append-retry; TI-25 `NoteEditor` ordering test; **TI-33 `NoteCardList` Scan→GSI**; **TI-34 Lambda naming audit**; _(in progress, one branch)_ **TI-32 SnapStart priming + TI-35 ReadyToRun** — the two cold-start fixes from the 2026-06-13 latency investigation; _(partly)_ TI-7 ESLint import-resolver + typed-lint (jsx-a11y done via 19-F3); TI-3 state-mgmt colocation; TI-24 deploy-credentials root cause. **The 2026-06 dependency upgrade audit (T1/T7/T2/T3/T4 = TI-27/28/29/30/31) is fully cleared.**

> Items carry stable IDs `TI-1`–`TI-31` in document order (the `ID` column above); each detailed section below repeats its ID. Reference an item as `TI-N`. The dep-audit `T#` tags are retained in parentheses for cross-reference with the audit report.

> **Dependency upgrade audit (2026-06-11):** full inventory + LTS recommendations in [docs/dependency-audits/dependency-upgrade-audit-2026-06.md](dependency-audits/dependency-upgrade-audit-2026-06.md). High + medium-urgency items (T1, T7, T2, T3, T4) are **all ✅ done** (TI-27/28/29/30/31). Low-urgency items (T5 lint-tooling batch, T6 Tiptap 3.26, T8 CDK 2.258, T9 Playwright 1.60, T10 xUnit v3) stay in the audit doc until picked up.

---

## TI-1. Decide on a server-state library (TanStack Query / SWR) vs hand-rolled hooks — and record it

**Resolved** by [ADR 0010](adr/0010-server-state-strategy.md) (slice 14-W) — **deferred, stay hand-rolled**. The decision is to keep the hand-rolled `useEffect`-fetch + `useState` hooks for now because this repo is a learning vehicle; adopting TanStack Query / SWR would hide the server-state mechanics we want to learn. See the ADR for the rationale and the "Revisit when" triggers that would graduate a library migration to its own numbered phase.

---

## TI-2. Stricter TypeScript compiler flags beyond `strict`

**Graduated → [Phase 19](phases/phase-19.md)** (slices **19-B** `noImplicitOverride` + **19-C** `noUncheckedIndexedAccess` → `exactOptionalPropertyTypes`). Same work; tracked in the phase doc. Removed here to avoid a duplicate backlog.

---

## TI-3. Frontend state-management hygiene — colocation + Context performance

**Context-performance half ✅ Done** as **[Phase 19-D](phases/phase-19.md)** (2026-06-05): `AuthContext`/`ToastContext` provider values memoised, Auth actions `useCallback`-wrapped. **Colocation half — Open:** state colocation (keep state nearest its consumer; prefer component composition over Context for prop drilling) stays an ongoing convention, not a slice — candidate to fold into the `frontend-react` skill if it recurs in review.

**Raised in:** Frontend standards research 2026-06-04 (react.dev useContext / KCD colocation).
**Depends on:** —

---

## TI-4. Core Web Vitals — bundle budget gate + CLS sizing + non-urgent transitions

**Graduated → [Phase 19](phases/phase-19.md)** (slice **19-I** — lazy-load Tiptap + transcribe-streaming, CI bundle-size budget; CLS sizing + `useTransition`/`useDeferredValue` folded into the same slice). Targets (field, 75th pct): LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1. Tracked in the phase doc; removed here to avoid a duplicate backlog.

---

## TI-5. Network resilience — retry transient failures with backoff

✅ **Done** (Phase **20-G**, deploy on the TanStack Query migration). `web/src/api/client.ts` `apiFetch` retries transient failures (5xx / 429 / network drop) with **exponential backoff + full jitter**, honouring `Retry-After`, capped at 3 attempts. Scoped to safe **reads** (GET/HEAD) only — writes are optimistic-with-rollback and `mutations.retry:false`, so transport-retrying a PUT/DELETE would only delay rollback and a POST retry would risk a duplicate create. 401 is handled separately (not transient). This was tracked as Phase **19-H**; the 20-G implementation note records it as subsuming 19-H.

**Raised in:** Frontend standards research 2026-06-04. **Actioned:** Phase 20-G.

---

## TI-6. XSS hardening — allowlist URL schemes on user-derived `href`/`src`

**Graduated → [Phase 19](phases/phase-19.md)** (slice **19-J** — configure the Tiptap Link extension explicitly to allowlist schemes and reject `javascript:` / `data:`). A `javascript:` URL in rendered note content is a stored-XSS vector the HTML-body DOMPurify guardrail does not cover (it sanitises bodies, not anchor hrefs). Guardrail-ahead-of-need: only bites once user/AI-derived links render as anchors. Tracked in the phase doc; removed here to avoid a duplicate backlog.

---

## TI-7. ESLint `jsx-a11y` (blocked on ESLint 10) + `import` rules follow-up + `@/` alias

**Status of the three originals (Phase 14):**

- **`@/` path alias** — ✅ **Done** (Phase 14-Q): `resolve.alias` in `vite.config.ts` + tsconfig `paths`.
- **Import ordering** — ✅ **Done** (Phase 14-R), but via **`eslint-plugin-import-x`** (the maintained, flat-config-native fork), NOT `eslint-plugin-import` — the latter peer-caps at ESLint 9 and the project is on **ESLint 10**. Only `import-x/order` was enabled.
- **`eslint-plugin-jsx-a11y`** — ✅ **Done (Phase 19-F3, PR #236)**: the ESLint-10 peer-cap was the deferral reason, but it is only an _install-time_ constraint — the plugin runs fine on ESLint 10. Resolved with a **scoped `package.json` `overrides`** pinning jsx-a11y's eslint peer to the root eslint (`eslint-plugin-jsx-a11y` → `eslint: "$eslint"`), which keeps `npm ci` green **without** the repo-wide `--legacy-peer-deps` that the 14-S/T deferral was avoiding. Adopted `recommended` at `error`, backlog triaged. Remove the override once jsx-a11y ships a v10 peer range.

**Remaining work (this item):**

1. **`import-x/no-unresolved` + `import-x/no-cycle`** — the original AC also named "catch unresolved/circular imports", which 14-R did not enable (needs `eslint-import-resolver-typescript` wired for the `@/` alias; `no-cycle` can be noisy). Add these on a follow-up pass.
2. **Typed-lint family — adopt `@typescript-eslint` `recommended-type-checked`** (needs `parserOptions.project` wired; this is Phase **19-B**). Unlocks the machine-enforced half of the TS conventions just added to the `frontend-react` skill: `no-floating-promises` + `no-misused-promises` (the #1 silent async bug — un-awaited promises, async `onClick`), `no-non-null-assertion` (bans `!`), `no-explicit-any`/`no-unsafe-*`, `prefer-nullish-coalescing` + `prefer-optional-chain`. Expect a one-time backlog to clear; introduce in `warn` then promote to `error`. Note: typed lint is slower (whole-program) — keep it to `*.ts/*.tsx` and confirm CI time is acceptable.
   **Why it matters:** a11y and import-hygiene enforcement turn "please remember" into "the build fails if you don't." `react-hooks` + `import-x/order` are now active; typed-lint closes the async-promise and `!`/`any` gaps; this closes the remaining gaps.
   **Raised in:** Frontend standards review 2026-06-03; updated after Phase 14-Q/R/S/T (ESLint-10 plugin-ecosystem gap discovered).
   **Depends on:** nothing external — `jsx-a11y` shipped via 19-F3 (scoped `overrides`); the remaining import-resolver rules and typed-lint (19-B) are unblocked.

---

## TI-8. Migrate `App.css` to CSS Modules

✅ **Done** (Phase 14, completed by slice 14-P, 2026-06-03). `web/src/App.css` is deleted. The `:root` tokens + every `[data-theme]` block (plus a new `--space-*` spacing scale) live in `web/src/styles/tokens.css`; reset/base-element rules in `web/src/styles/global.css`, both imported once at the app root. Every component now owns a co-located `*.module.css` with `camelCase` classes and `styles.*` references; `clsx` was added for conditional classes. Migration was shipped component-by-component across Phase 14 (14-E/F/G/H/I/J/K/L/M/N/P), regression-checked by the Vitest/RTL suite and `Browser.E2E` journeys.

> This item and **"Break down the monolithic `App.css` into a proper CSS architecture"** below describe the same work — both are now complete.

**Raised in:** Frontend standards update, 2026-06-02. Decision: CSS Modules, incremental migration with a near-term dedicated full-migration effort.

---

## TI-9. Upgrade GitHub Actions to Node.js 24

✅ **Done** (2026-06-04). Every action across `deploy.yml`, `eval.yml`, and `pr.yml` was bumped to its latest node24 major: `checkout@v6`, `setup-node@v6`, `cache@v5`, `setup-dotnet@v5` (also a node20 action — added to scope), `upload-artifact@v7`, `aws-actions/configure-aws-credentials@v6`. Runtime confirmed `node24` for each via the GitHub API; major-version release notes checked for breaking changes — none affect this repo (`setup-node` auto-cache needs a `packageManager` field we don't have; aws-credentials v5 boolean-input cleanup is moot as we pass only string inputs; `checkout` v6 separate creds-file is harmless). Two non-obvious floors: `upload-artifact` needs **v6+** (v5 still defaults to node20) and `aws-credentials` needs **v6** (v5 is node20).

**Deliberately not changed:** `setup-node`'s `node-version: "20"` (the Node used to _build_ the frontend) stays at 20 — that is separate from the action-runtime deprecation and is governed by the `package-lock.json`/Node-version guardrail in CLAUDE.md. Bumping the build Node is its own decision (would require regenerating the lock file on Node 24).

**Why it mattered:** Node.js 20 actions are deprecated; GitHub forces Node.js 24 by default from 2026-06-02 and removes Node 20 from runners on 2026-09-16.
**Raised in:** Phase 6 / adhoc CI observation. **Actioned:** 2026-06-04.

---

## TI-10. Resolve ESLint warnings in `web/src/auth/AuthContext.tsx`

✅ **Done** (PR #172, 2026-06-04). All four repo-wide lint warnings cleared:

- `AuthContext` + `useAuth` moved into `web/src/auth/context.ts` (named `context.ts`, not `authContext.ts`, to avoid a case-collision with `AuthContext.tsx` on the case-insensitive `/mnt/c` filesystem); `AuthProvider` is now the only export of `AuthContext.tsx`, restoring Fast Refresh.
- `ToastContext` + `useToast` split out into `web/src/components/toastContext.ts` the same way.
- The one-shot OAuth-exchange `useEffect` now takes its stable `clientId`/`initialToken` deps, clearing the last `react-hooks/exhaustive-deps` warning. No behaviour change.

**Raised in:** CI annotation review, 2026-06-02 (`validate-frontend`). **Actioned:** 2026-06-04.

---

## TI-11. Add `cdk synth` to the pre-commit hook

**✅ Done** (2026-06-10): `.githooks/pre-commit` now runs `dotnet publish src/Api` + `cdk synth --quiet` after the backend block. **Cost-gating decision:** synth is slow (needs a Release publish first), so it runs **only when infra-affecting files are staged** — `src/Infrastructure/`, `src/Api/`, any `*.sln`/`*.csproj`/`*.props`/`*.targets`, or `cdk.json` — matched by a new `infra` flag. Docs-only, web-only, and tests-only commits skip it. Uses the global `cdk` CLI (`aws-cdk@2`), matching CI; no AWS creds needed (the app does no context lookups).

**What:** The pre-commit hook builds, lints, typechecks, and runs the test suites, but did **not** run `cdk synth`. Added so the local gate matches the guardrail "Never commit without all BDD specs green and `cdk synth` succeeding."
**Why it matters:** The hook otherwise lets through commits that break CDK synthesis, which then fail later in CI/deploy.
**Raised in:** Spun off from the now-resolved stale-test-paths fix (840464b) — that change corrected the hook's project paths and removed the leftover empty test dirs, but left the `cdk synth` suggestion unactioned.

---

## TI-12. Split the single API Lambda into individual Lambdas (CQRS + async projectors)

**Graduated → [Phase 27](phases/phase-27.md)** (Stage 1 — CQRS write/read split + async projectors). Four slices: extract a shared idempotent `ProjectionUpdater` (27-A), enable a DynamoDB Stream + Projector Lambda in shadow with DLQ/alarms (27-B), cut over to async + move read-after-write tests to polling (27-C), split the HTTP Lambda into Command + Query functions with least-privilege IAM (27-D). **Stage 2** (per-context command Lambdas) and stream-replay rebuild stay out of scope; pick them up as follow-ons. Original entry kept below for context.

**What:** The backend currently runs as one `ApiFunction` Lambda (ASP.NET minimal API behind an HTTP API proxy) that handles every route and updates all projections **synchronously in-process, inline in the command handlers** (e.g. `NoteCommandHandler.UpdateProjectionAsync`) before returning the HTTP response. Move to a deployment shape that matches an event-sourced system, in two stages:

1. **Stage 1 — CQRS + async projectors (do first).** Split write from read into separate Lambdas, and move projection-building off the request path onto **DynamoDB Streams** (or EventBridge): a **Command Lambda** appends events only; a **Projector Lambda** (idempotent, replayable) rebuilds read models off the stream; a **Query Lambda** serves reads from projections.
2. **Stage 2 — per-context command Lambdas (when ready to take it on).** Split the command surface by bounded context (Note / Folder / Calendar / Transcription / Todo) into separate Lambdas for deploy and scaling isolation and tighter per-context IAM. Adopt incrementally, only where a context earns it (e.g. Transcription's different runtime profile) — not wholesale.

The full rationale, target diagrams, staged migration plan, and the eventual-consistency trade-off are in **[ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md)**.

**Why it matters:** This is the defining event-sourcing deployment lesson for the project — an append-only log with decoupled, replayable async consumers — and it's the largest remaining ES learning surface (Streams, idempotency, replay, eventual consistency, async failure handling, DLQs/alarms). It also shrinks the write path and tightens per-Lambda IAM (today one role grants read/write on ~10 tables).

**Headline trade-off:** Stage 1 replaces today's immediate read-after-write consistency with **eventual** consistency (projector lags the write by stream latency, typically <1s). The frontend's optimistic updates already insulate the user, but server-side read-after-write — **smoke tests, E2E tests, and any read-after-append flow** — must move to retry/polling. Async projection failures also become invisible (DLQ + alarm) rather than a synchronous 500, so observability must be wired in the same slice.

**Raised in:** Architecture discussion, 2026-06-02 — desire to align the deployment with the event-sourced design.
**Depends on:** Nothing blocking. Pairs with the `observability` skill (async failure visibility). Best done as its own numbered phase given the breadth; graduate Stage 1 to a phase when picked up.

---

## TI-13. Reduce Lambda SnapStart costs

✅ **Done** (2026-06-03) — investigated against prod (account 642653037268, eu-west-2) and right-sized via memory reduction.

**Findings:**

- **Version accumulation is not happening.** The version counter is at 164, but CloudFormation retains only the active version plus two May-20 orphans (42, 43); it replaces the published version on each deploy rather than piling them up. Orphan snapshots auto-expire after 14 days with no invocation, so they self-clean.
- **Cost is almost entirely snapshot-cache storage** (`SnapStart-Cached-GB-S`, ~$4–5/mo), billed per GB of `MemorySize`. Restore charges (`SnapStart-Restored-GB`) are ~$0.03/mo and per-request compute (`Lambda-GB-Second`) is ~$0 (free tier).
- **SnapStart earns its keep — kept on.** Cold starts are not rare (~10–25/day, 300+/mo) and SnapStart restores them in ~400–650 ms vs the multi-second .NET 10 cold init without it. Disabling it would save ~$50/yr but regress hundreds of requests/month.
- **The lever was memory, not versions.** The function was provisioned at 512 MB but peak `Max Memory Used` is ~165 MB (~3× over-provisioned).

**Action taken:** Dropped `ApiFunction` `MemorySize` 512 → 256 MB (~55% headroom over observed peak), roughly halving the dominant cache-storage cost _and_ per-request compute. CDK assertion updated to match. Watch restore duration post-deploy — less memory means less vCPU, so if restore latency climbs materially, bump to 384 MB.

**Raised in:** Cost-review observation, 2026-06-02. Actioned 2026-06-03.

---

## TI-14. Break down the monolithic `App.css` into a proper CSS architecture

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

---

## TI-15. Add a shared modal focus-trap utility and apply it across all dialogs

✅ **Done** (2026-06-10). `useFocusTrap(ref, { onClose })` lives in `web/src/hooks/useFocusTrap.ts` — on mount it captures `document.activeElement`, focuses the first focusable element (or the container, falling back to `tabindex="-1"`), cycles Tab / Shift+Tab within the dialog's focusable set, and restores focus to the captured element on unmount; `onClose` is an optional Escape consolidation that both current dialogs leave unused (Escape stays where it lived). Applied to `MeetingPicker` and `SessionExpiredBanner`. Vitest coverage: focus-into-dialog-on-open, Tab/Shift+Tab wrap, and focus-restore-to-trigger-on-close. **Also delivers the shared utility that [Phase 19-F](phases/phase-19.md)'s per-surface focus work would otherwise have to build** — 19-F now only needs to apply the existing hook to its remaining surfaces.

**What:** `MeetingPicker` (slice 17-B) is the app's first true `aria-modal="true"` dialog. It handles Escape + click-outside but does **not** move focus into the dialog on open, trap focus within it, or return focus to the trigger on close. The pre-existing `SessionExpiredBanner` shares the `dialog` role and the same gap. There is no focus-trap utility in the codebase.

**Why:** Keyboard and screen-reader users can tab out of an open modal into the page behind it; on close, focus is lost rather than returned to the control that opened it. This is a real WAI-ARIA dialog gap, not a regression — both dialogs share it.

**How:** Add a small `useFocusTrap(ref, { onClose })` hook (focus first focusable / the dialog on mount, cycle Tab/Shift+Tab within, restore `document.activeElement` captured on open) and apply it to `MeetingPicker` and `SessionExpiredBanner` together, so the bar moves for all dialogs at once.

**Raised in:** Hawk review of PR #177 (slice 17-B), 2026-06-05 — flagged as a low-severity gap, recommended deferring as a cross-dialog follow-up rather than a one-off.
**Depends on:** Nothing blocking.
**Overlaps [Phase 19-F](phases/phase-19.md)** (focus management for 3 dialog/popover surfaces). 19-F is per-surface; this item is the shared `useFocusTrap` utility behind it. Best built once as part of 19-F and applied to `MeetingPicker` + `SessionExpiredBanner` together. Stays here as the utility's home until 19-F is scoped.

---

## TI-16. Make the projection-rebuild endpoint robust (it 500s + partial-rebuilds under burst)

✅ **Done — [Phase 24](phases/phase-24.md) complete (24-A/B/C all Done).** Bounded+retried writes with a longer admin-path timeout (24-A), upsert-and-reconcile replacing delete-first (24-B), and operability — per-projection summary, fault metric/alarm, overlapping-rebuild guard (24-C). The rebuild is now first-try reliable against cold tables and incapable of silent partial loss. History retained below.

**Graduated → [Phase 24](phases/phase-24.md).** `POST /admin/projections/rebuild` deletes every projection first, then re-upserts ~290 rows via an unbounded `Task.WhenAll` against a 5s-per-op client — a cold on-demand table throttles, writes cancel, `Task.WhenAll` throws → 500, and delete-all-first leaves a **partial rebuild** (silent missing rows). Reliable only on the second try (warm tables). Confirmed in prod 2026-06-05 (Phase 17 backfill, 2 ops canceled at 5s) and recurred 2026-06-08 (Phase 22). The fix (bounded+retried writes, admin-path timeout, upsert-and-reconcile instead of delete-first, operability) is now broken into Phase 24-A/B/C. The `NoteSearchView` tombstone item below is folded into **24-B**.

---

## TI-17. Auto-backfill a new projection on deploy (new projections ship empty)

**What:** A deploy creates a new projection's table but **never populates it** — there is no automatic rebuild — so a newly-shipped projection holds only entities written _after_ the deploy. The feature reads empty in prod while every test passes. The current mitigation is a manual post-deploy `POST /admin/projections/rebuild` (now a mandatory Scribe step + CLAUDE.md guardrail for projection-adding slices), but that is human-triggered and was missed once.

**Confirmed in prod, 2026-06-08:** Phase 22 search returned **no results** because `notetaker-proj-notesearchview` had 1 of ~12 live notes — the 22-A deploy created the table but nothing rebuilt it. A manual rebuild fixed it.

**Why it matters:** silent, repeats for _every_ future projection, and the symptom (feature returns nothing) looks like a code bug, not an ops gap.

**Fix options:** (1) detect new projection tables in the deploy job and POST the rebuild automatically (idempotent) after deploy; or (2) a deploy step that diffs the projection set and rebuilds only the new ones (needs the rebuild-robustness fix so a bulk rebuild can't partial-fail). Pairs with the rebuild-robustness item.
**Raised in:** Phase 22 search backfill, 2026-06-08.
**Depends on:** **[Phase 24](phases/phase-24.md)** (a safe auto-rebuild must not partial-fail). Pick this up once Phase 24 lands.

---

## TI-18. Rebuild emits delete tombstones for `NoteSearchView` (rebuild soft-deletes; live hard-deletes)

✅ **Done — Phase 24-B.** The rebuild now matches the live hard-delete: `ProjectionRebuildHandler` (1) excludes deleted notes from the upsert set (`searchView.GetAll().Where(v => !v.Deleted)`), and (2) reconciles — enumerates the live table via `QueryAllAsync`, diffs against the live `NoteId` set, and `DeleteAsync`-es every orphan tombstone. No `Deleted=true` rows survive a rebuild. The 80 historical tombstones are pruned on the next `/admin/projections/rebuild`. History retained below.

**What:** The **live** delete path hard-deletes the search row on `NoteDeleted` (`DynamoDbNoteSearchViewStore.DeleteAsync`), but the **rebuild** path writes deleted notes as `Deleted=true` rows (the `NoteSearchViewProjection` keeps them and `GetAll()` returns them). After the Phase 22 prod backfill the table held **80 `Deleted=true` tombstones** alongside 11 live rows.

**Why it matters:** search correctness is fine (the endpoint filters `Deleted`), but every search's `UserId-index` GSI query now returns the tombstones too and the in-Lambda rank scans them (inflated `notesScanned`/latency), and the two delete strategies diverge. Low severity, grows with deletion volume.

**Fix:** make the rebuild projection prune deleted notes (drop them from `GetAll()`) so the rebuilt table matches the live hard-delete, OR have the rebuild explicitly skip upserting `Deleted` search rows.
**Raised in:** Phase 22 search backfill verification, 2026-06-08.
**Scheduled:** folded into **[Phase 24-B](phases/phase-24.md)** (upsert-and-reconcile prunes the tombstones).

---

## TI-19. Stabilise the flaky `TagsJourney` E2E (post-deploy gate fails intermittently)

✅ **Resolved by [BUG-17](phases/phase-bugs.md#bug-17--concurrent-multi-word-tag-add-silently-drops-a-tag-no-handler-retry-on-conflict)** (PR #217, deploy #506, 2026-06-10). The remaining _removed-tag-lost_ half was a real backend lost-write, not test timing: a space-separated multi-tag add fans out into two concurrent same-stream appends; the loser hit `ConcurrencyException` and was **silently dropped** because `NoteCommandHandler` never retried the append (the frontend swallowed the 409, then the phantom tag's removal 404'd and rolled back). A deterministic `ConflictingEventStore` repro confirmed it. Fix: bounded retry-on-conflict in the command handler (re-read→re-run→re-append) + `untagNote()` treating 404/409 as OK. Deploy #506 ran `TagsJourney` **14/14 green** on the first full E2E pass. History retained below.

⚠️ **(Historical) Partially fixed — recurred, re-opened.** PR #205 (deploy #495) fixed **[BUG-14](phases/phase-bugs.md#bug-14--pasting-space-separated-tags-intermittently-drops-a-pill)**, the _dropped-add_ half: tagging a freshly-created note while its initial `keys.note` GET is in flight made the optimistic patch a no-op, the GET resolved tagless, and nothing refetched — so a pasted multi-tag (`"1:1s Bill"`) dropped a pill. The first attempt (PR #203) misdiagnosed it as cold-start latency and raised the E2E tag-pill timeout 15s→45s; deploy #493 failed **with the 45s applied** (`ToBeVisibleAsync with timeout 45000ms`), disproving latency — PR #205 reverts to 15s. **Lesson:** a near-deterministic "element never appears" timeout (vs an occasional _slow_ one) is a _missing render_, not latency.

**But deploy #496 (24-C, an unrelated backend-only change) then failed `RemoveTag_GoneAfterNavigation`** — a _different_ symptom: after `AddTagAsync("1:1s Bill")` → `RemoveTagAsync("Bill")` → save → reopen, the **removed** "Bill" pill is **still present** on the server-fresh reopen (`expected not to be visible`, resolved visible 9×). The BUG-14 patch addressed the dropped-add path; the _removed-tag-lost_ path survives. Likely a backend optimistic-concurrency interaction: the two concurrent multi-tag adds (one retries on 409) race the subsequent remove, so the remove writes at a stale stream version and is silently lost. Re-cleared the gate for 24-C by re-running deploy #496 (intermittent — #495 ran the same test green). **Still open**; needs a reproduction test for the add-add-then-remove interleave, not another timeout bump.

**Recurred again on deploy #501 (PR #213, 2026-06-10) — the strongest change-independence evidence yet.** #213 was a **docs + CI-config-only** PR (`.github/workflows/*.yml` + `docs/`, zero application/test code), yet `deploy-test` failed the E2E gate **three runs in a row**: run 1 failed both `RemoveTag_GoneAfterNavigation` _and_ `RemoveTag_PillDisappears` (2/14), the two reruns failed `RemoveTag_PillDisappears` alone (1/14). A docs/CI PR cannot touch tag behaviour, so this rules out any per-slice regression and points squarely at the backend add-add-then-remove optimistic-concurrency race described above (or test-side ordering). The flake now blocks unrelated CI/docs deploys, not just feature slices — raising its priority. **Fix needs the reproduction test, not reruns.**

**Recurred on deploys #502, #503 and #504 (2026-06-10) — `RemoveTag_GoneAfterNavigation` again.** Three consecutive main deploys (23-B, 25-A, BUG-16) each failed the E2E gate on first attempt and each went green on a single rerun. While BUG-16 (a frontend auth change, change-independent of tag behaviour) sat approved with all its own gates green, this flake gated its merge twice (it had to wait out #502 and #503 reruns) and then its own deploy (#504) once. Cumulative: ≥6 deploys gated (#485/#491/#496/#501/#502/#503/#504). The "single rerun clears it" pattern keeps masking the cost, but it now routinely delays unrelated merges. Priority restated: write the add-add-then-remove reproduction test and fix the race; do not keep absorbing it via reruns.

<details><summary>Original entry (kept for context)</summary>

**What:** `Browser.E2E.Journeys.TagsJourney` flakes in the `deploy-test` E2E step — a single test fails (13/14 pass), a **different** one each run, always a Playwright "element not visible" timeout on a tag pill just after `AddTagAsync`. Confirmed pre-existing and **change-independent**: deploy **#485** (2026-06-08) failed `RemoveTag_PillDisappears` _before_ slice 19-D existed; deploy **#491** (19-D, a memoisation-only change inert in the E2E auth path) then hit it three runs running — `AddMultipleTags_SpaceSeparated`, `RemoveTag_PillDisappears`, `RemoveTag_GoneAfterNavigation`. No browser-console JS/React errors in any failure.

**Why it flakes:** `AppPage.AddTagAsync` waits on the `/tags` POST response, then `AssertTagPillVisibleAsync` polls for the pill with a **15s** timeout. On a cold post-deploy environment (cold Lambda + cold DynamoDB tables) the create-note + tag round-trip races that timeout, so whichever tag test runs while the stack is coldest times out. The tag pill render is gated on the server round-trip in the journey, so latency — not correctness — decides pass/fail.

**Why it matters:** a flaky post-deploy gate forces repeated `gh run rerun` (19-D needed 4 attempts), and a red main deploy blocks the _next_ slice's merge gate ("main's latest deploy must be green").

**Fix options (pick one or combine):**

1. Raise the tag-pill assertion timeout (15s → 30s) to absorb cold-start latency — smallest change.
2. Pre-warm the stack before the E2E run (one throwaway request per cold path) so the first real tag op isn't cold.
3. Make tag-pill rendering optimistic in the journey's eyes (assert the optimistic pill, not the server-reconciled one) — but NoteView tags are still hand-rolled until 20-E, so revisit alongside that.

**Raised in:** Operating the 19-D deploy, 2026-06-09 (this session).
**Depends on:** Nothing blocking.

</details>

---

## TI-20. `WorkspaceList` reads via full table Scan, not a per-user GSI

`DynamoDbWorkspaceListStore.GetAllAsync` does a paginated cross-user `Scan` (`ConsistentRead = true`) and is called on **every** `GET /workspaces`, every rename (`ApplyRenamedAsync` re-scans to point-update one row), and every ownership check (`OwnsAsync`). The closest precedent, `NoteSearchView`, uses a `UserId-index` GSI + `Query` for exactly this access pattern.

**Why it's fine for now:** workspaces-per-user is tiny (low single digits), so the scan reads a handful of rows. **Why it's worth fixing:** it is an architectural inconsistency that scales O(all users' workspaces), and `ApplyRenamedAsync` loads the whole table to update one known row.

**Fix:** add a `UserId` GSI to `notetaker-proj-workspacelist` and switch reads to a per-user `Query`; give the rename path a point `Get`/re-upsert instead of a scan. Fold in if Phase 23-B's scoping work touches this store.

**Raised in:** Hawk review of PR #207 (slice 23-A), 2026-06-10.
**Depends on:** —

---

## TI-21. CI pipeline hygiene — skip no-op deploys, cancel superseded PR runs, cache Playwright

✅ **Done** (2026-06-10, this PR). Three independent pipeline optimisations shipped together:

1. **Skip deploys on eval-harness-only changes.** Added `tests/Analysis.Eval/**` to `deploy.yml` `paths-ignore`. That project is built/run only by `eval.yml` (nightly + manual dispatch) and the `Makefile`; it is never part of the deployed artifact (`src/Api`). A push to main touching only the eval harness (e.g. judge-prompt/matrix tweaks like #210) previously ran a full ~12-min test+prod deploy for nothing. **Trade-off accepted:** a broken eval build is no longer caught by deploy's `validate-backend`, but `eval.yml` already builds that project.
2. **Cancel superseded PR runs.** Added a `concurrency` group to `pr.yml` keyed per-PR (`github.head_ref`) with `cancel-in-progress: true`. Pushing a new commit to a PR previously ran the full backend+frontend+eventstore suite to completion even when obsolete; now the in-flight run is cancelled. Safe — only the latest commit's checks matter. Does not touch the `deploy.yml` concurrency groups (deploys must never cancel).
3. **Cache Playwright browsers.** Added an `actions/cache@v5` step on `~/.cache/ms-playwright` before the E2E `Install Playwright browsers` step in `deploy.yml`, keyed on the pinned `Microsoft.Playwright` version (hash of `Browser.E2E.csproj`). The chromium binary was re-downloaded every deploy (~30–60s); on a cache hit `playwright install` skips the download. `--with-deps` still runs to install OS apt libraries (not cacheable — ephemeral runner).

**Why it matters:** removes wasted runner minutes and shortens the merge→deploy loop that gates parallel slices.
**Raised in:** Pipeline-optimisation review, 2026-06-10. **Actioned:** same session.
**Depends on:** —

> **Considered and rejected:** mirroring the `tests/Analysis.Eval/**` ignore into `pr.yml`. PR checks are the merge gate; an eval-only PR that skips them produces no `backend`/`frontend` checks, which the CLAUDE.md merge rule relies on being present and green (`gh pr checks` could read falsely green on a near-empty list). A "build once, deploy twice" refactor (share the Lambda zip + frontend base bundle between `deploy-test` and `deploy-production`) was also identified — larger, restructures the job graph, deferred to its own change.

---

## TI-22. Skip backend publish + `cdk deploy` on frontend-only pushes

✅ **Done** (2026-06-11, this PR). A `detect-changes` job (`dorny/paths-filter@v3`) sets `backend = true` when the push touches any path that can change the deploy artifact: `src/**` (Lambda asset = `src/Api` + refs; CDK template = `src/Infrastructure`), `cdk.json` (CDK app command + context/feature flags → alters synth), or `ai-note-taker.sln`. `deploy.yml`'s **Install CDK CLI**, **Publish Lambda**, and **Deploy infrastructure** steps now carry `if: needs.detect-changes.outputs.backend == 'true'`. Stack outputs (`ApiUrl`/`WebUrl`/`WebBucketName`/`DistributionId`/`RumMonitorId`/`RumIdentityPoolId`) are now resolved via `aws cloudformation describe-stacks` instead of the cdk `--outputs-file`, so they resolve on both paths — on a frontend-only push the backend steps are skipped but the live stack still holds the outputs the frontend deploy needs. The resolve step fails fast (`set -e` + per-output non-empty assertion) rather than syncing to an empty bucket/distribution if an output is ever absent.

**Deploy-time delta:** frontend-only pushes save ~137s (`cdk deploy`, dominated by the SnapStart snapshot republish) + ~10s publish + ~15s CDK CLI install **per environment** → **~5 min/pipeline** off frontend-only slices. Backend/infra pushes: neutral (full path unchanged; the `--outputs-file` → `describe-stacks` swap adds ~1 idempotent API call). Recurring saving, no standing cost — satisfies the deploy-time guardrail.

**Why it matters:** frontend-only slices are common, and they were paying the full backend SnapStart bake twice (Test + Production) for a byte-identical stack.
**Scope note:** touches `deploy.yml` only — **not** `pr.yml`, so the merge-gate `backend`/`frontend` checks still run full on every PR (avoids the false-green pitfall recorded under _CI pipeline hygiene_ above). Separate AWS accounts for Test/Production confirmed, so the per-account `describe-stacks` is correctly scoped by each job's creds.
**Raised in:** deploy-time review, 2026-06-11. **Actioned:** same session.
**Depends on:** —

---

## TI-23. Generalise append-retry-on-conflict beyond `NoteCommandHandler`

BUG-17 (PR #217) added a bounded retry-on-`ConcurrencyException` (re-read→re-run→re-append) to `NoteCommandHandler.ExecuteAsync` only. `ActionItemCommandHandler` shares the same optimistic-concurrency append but was left out: it interleaves projection writes with its append (not the clean read→handle→append cycle), and its streams are keyed per action item, so the BUG-17 multi-writer-on-one-stream race is far less likely there.

**Why worth doing:** the latent lost-write still exists for rapid concurrent writes to a single action-item stream (e.g. fast complete/reopen toggles). **Fix:** extract a shared `AppendWithRetry` helper (or a handler base method) so the retry is defined once and applied wherever the read→handle→append pattern lives, rather than duplicated. Do it only if a second handler needs it — don't abstract for one caller.

**Raised in:** Hawk review of PR #217 (BUG-17), 2026-06-10.
**Depends on:** —

---

## TI-24. `deploy-production` hangs at "Configure AWS credentials"

**Mitigated 2026-06-11** — added `timeout-minutes: 5` to the `Configure AWS credentials` step in **both** deploy jobs (`deploy-test` + `deploy-production`). A silent 30+ min hang now fails fast and is recovered by a rerun, so it no longer blocks a green main indefinitely. Root cause still **unconfirmed** (capture the step log next time it hangs); a version bump or step-level retry remains a possible follow-up.

The `deploy-production` job in `deploy.yml` intermittently (~half of deploys during Phase 25) **hung at the `Configure AWS credentials` step** for 30+ minutes with no progress and no error, before any Lambda/CDK deploy started. The step uses `aws-actions/configure-aws-credentials@v6` with **static access keys** (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) — so the hang is the action validating those keys via `sts:GetCallerIdentity`, stalling on a transient STS/network blip (not OIDC `AssumeRole`, and not a broken role/trust — other deploys with the same secrets succeed). The only recovery found before the timeout was `gh run cancel <id> && gh run rerun <id>`, which clears it on a fresh runner.

**Why it mattered:** each hang cost ~30 min of dead wall-clock and blocked the merge→deploy→merge loop for parallel slices; it bit 25-A/B/C deploys repeatedly. **Remaining follow-ups (optional):** pin/bump `aws-actions/configure-aws-credentials`; add a step-level retry so it self-heals without a manual rerun; or root-cause the STS-endpoint flakiness from a captured step log.

**Raised in:** Phase 25 pipeline (repeated deploy hangs), 2026-06-11. **Actioned (timeout):** same day.
**Depends on:** —

---

## TI-25. Add a `NoteEditor` component test for the image upload/serialize ordering invariant

Phase 25-B shipped (then fixed) an **ordering bug** that every unit test passed and only the deploy-time E2E (`NoteImageJourney`) caught: the image node was inserted with a `blob:` src _before_ its stable key was mapped, so a save during the upload window dropped the image. The fix (presign-first) re-encodes the load-bearing invariant — _seed the `src→key` map before inserting the node_ — as two adjacent statements in `NoteEditor.tsx` with **nothing pinning the order below the slow deploy E2E gate**. The pure `noteImages.test.ts` covers only the rewrite helpers.

**Why it matters:** a future refactor of `NoteEditor` could reorder seed-vs-insert and silently reintroduce the data-loss bug; CI wouldn't catch it until a ~15-min deploy E2E (which itself flakes/hangs). **Fix:** a `NoteEditor.test.tsx` (RTL + mocked `presignUpload`/`fetch`) asserting (a) `onChange` is never called with a `blob:`/unmapped src during a paste→presign→PUT sequence — the first `onChange` after insert already carries the key; and (b) on PUT failure the node is removed and `onChange` re-fires without the key. Tiptap-in-jsdom made this non-trivial, so it was deferred from the slice.

**Raised in:** Hawk review of PR #220 (25-B presign-first fix), 2026-06-11.
**Depends on:** —

---

## TI-26. Zero-downtime deployments — frontend stale-chunk 404s; backend has no canary/rollback

✅ **Done — [Phase 26](phases/phase-26.md) complete.** 26-A (frontend two-pass upload, no `--delete`, immutable hashed assets, entry-point-only invalidation, S3 lifecycle GC) and 26-B (`vite:preloadError` reload safety net) shipped; 26-C (backend CodeDeploy canary) was shipped then **reverted same-day** as terminal — the ~5 min/deploy cost outweighed the protection for a single-user app (see `docs/learnings/deploy-time-is-a-first-class-cost.md`). The current-downtime frontend gap is closed. History retained below.

**Graduated → [Phase 26](phases/phase-26.md).** A `cdk deploy` is not fully zero-downtime. The backend alias flip is seamless (API Gateway routes to the `live` alias, SnapStart avoids cold starts) but is an instant 100% cutover with no canary or automated rollback. The real gap is the **frontend deploy job** (`deploy.yml:200`–`204`): `aws s3 sync … --delete` removes old content-hashed bundles the instant new ones land → a browser/CDN still holding the previous `index.html` 404s its bundle on reload → **blank app**; plus a `/*` invalidation cold-cache spike and no immutable caching. Severity rises the moment **[19-I](phases/phase-19.md)** ships dynamic imports over the `--delete` strategy (reload-404 → mid-session crash). Broken into **26-A** (frontend two-pass upload, no `--delete`, immutable hashed assets, entry-point-only invalidation, S3 lifecycle GC — the only current-downtime fix, do first and before/with 19-I), **26-B** (`vite:preloadError` reload safety net), and **26-C** (backend CodeDeploy canary wired to the existing error-rate + latency alarms for auto-rollback). Full GWT scenarios and acceptance criteria in the phase doc.

---

## TI-27. Frontend build Node 20 → 24 + regenerate lockfile (dep-audit T1)

✅ **Done** (PR #237, deploy #528, 2026-06-11). `node-version "20" → "24"` across `deploy.yml` (3) + `pr.yml` (2); `@types/node ^20 → ^24` (resolves 24.13.2); lockfile regenerated. Two non-obvious traps surfaced and are captured in [docs/learnings/node-24-build-upgrade.md](learnings/node-24-build-upgrade.md): (1) the lockfile/npm-version skew is **bidirectional** — regenerating on an _older_ local npm than CI's pruned the optional `@emnapi/*` native-binding entries CI's newer npm requires, failing `npm ci`; (2) `@types/node@24` dropped a transitive `lib` reference that had been silently providing ES2022 `Array.at()` to the **test** typecheck, so `tsc -p tsconfig.test.json` failed (fixed by making `tsconfig.test.json`'s `lib` explicit). Original entry kept below for context.

**Urgency: High (EOL).** Graduates the half deliberately deferred by _"Upgrade GitHub Actions to Node.js 24"_ (above) — that item bumped the action runtimes but left the **build** Node (`setup-node` `node-version: "20"`) on 20.

**What:** `node-version: "20"` → `"24"` in `deploy.yml` (3 sites) + `pr.yml` (2 sites); `@types/node` `^20` → `^24`; regenerate `web/package-lock.json` **on Node 24**.

**Why:** Node 20 reached EOL **30 Apr 2026** — CI builds the frontend on an unsupported runtime (no security patches). Node 24 is Active LTS (to Apr 2028); Node 22 (Maint LTS to Apr 2027) is the conservative fallback. Low risk — Node is build-tooling only; the Lambda runtime is .NET. **Unblocks T2 (Vite 7 needs Node ≥20.19/22.12).**

**Constraint:** regenerate the lockfile on the target Node version (CLAUDE.md guardrail — a lockfile cut on a mismatched npm/Node omits entries the other expects → `npm ci` fails). Since CI moves to 24, generate on 24 in the same PR.

**Raised in:** Dependency upgrade audit, 2026-06-11.
**Depends on:** — (blocks T2).

---

## TI-28. ASP.NET 10 servicing + AWS SDK patch bumps (dep-audit T7)

✅ **Done** (PR #241, deploy #530, 2026-06-11). 11 `.csproj`-only version bumps across `src/Api`, `src/EventStore`, `tests/Api.Integration`, `tests/Analysis.Eval` — no source changes. JwtBearer `10.0.0` → `10.0.9` (security servicing); Mvc.Testing `10.0.8` → `10.0.9`; `Amazon.Lambda.AspNetCoreServer.Hosting` `2.0.0` → `2.1.0`; `AWSSDK.*` (BedrockRuntime `4.0.20.5`, DynamoDBv2 `4.0.21.1`, S3 `4.0.24.3`, SecurityToken `4.0.7.3`, SimpleSystemsManagement `4.0.8.3`, Extensions.NETCore.Setup `4.0.4.6`); `Google.Apis.Calendar.v3` `1.74.0.4154`. `AWSXRayRecorder.Handlers.AwsSdk` (2.14.0) + `AWS.Lambda.Powertools.*` (3.2.2) already latest — no change. `BedrockRuntime` kept in sync across Api + Analysis.Eval. Deploy-time delta **neutral**. Verified: Release build 0 warnings, Domain.Specs 193/193, Api.Integration 325/325, EventStore.Integration (CI), cdk synth. **Note:** the only *minor* bump (`Amazon.Lambda.AspNetCoreServer.Hosting`, the APIGW↔ASP.NET adapter) is exercised only by post-deploy smoke, not PR CI — deploy #530 succeeded so it's confirmed live. Original entry kept below for context.

**Urgency: High (security).** `Microsoft.AspNetCore.Authentication.JwtBearer` is pinned at **10.0.0** while **10.0.9** ships (9 servicing patches behind, incl. security) — and it is exact-pinned, so it does **not** float with the SDK.

**What (batch):** JwtBearer `10.0.0` → `10.0.9`; `Microsoft.AspNetCore.Mvc.Testing` `10.0.8` → `10.0.9`; `Amazon.Lambda.AspNetCoreServer.Hosting` `2.0.0` → `2.1.0`; `AWSSDK.*` (BedrockRuntime, S3, DynamoDBv2, SecurityToken, SimpleSystemsManagement, Extensions.NETCore.Setup) → latest 4.0.x; `AWSXRayRecorder.Handlers.AwsSdk` + `Google.Apis.Calendar.v3` → latest within major. `AWS.Lambda.Powertools.*` already latest (3.2.2) — no action.

**Why:** auth-critical package behind on security servicing; the rest are routine patch/minor bumps within current majors (AWS SDK v4, .NET 10). Low risk. Run the full backend + Api.Integration suites.

**Raised in:** Dependency upgrade audit, 2026-06-11.
**Depends on:** —

---

## TI-29. Vite 5 → 7 + Vitest 2 → 4 (dep-audit T2)

✅ **Done** (PR #245, deploy #535, 2026-06-11). `vite ^5.4.10 → ^7.3.5`, `vitest ^2.1.9 → ^4.1.8`, `@vitejs/plugin-react ^4.3.3 → ^5.2.0` (v6 forces Vite 8; v5 is the Vite-7 partner). Lockfile regenerated incrementally on Node 24 / npm 11.13.0 (exact CI match). **Held at Vite 7, not the now-GA Vite 8** — the audit's "8 is beta" is stale, but Vite 8 stays a future TI per LTS-not-bleeding-edge (and plugin-react@6 would force it). `vite.config.ts` needed no migration. **Test fallout: 2 files, Vitest-4 mock semantics, TEST-ONLY** (no app source, no weakened assertions): (1) Vitest 4 constructs mocks via `Reflect.construct`, so arrow `mockImplementation`s for `AudioContext`/`AudioWorkletNode`/`TranscribeStreamingClient` (the app `new`s them) threw "not a constructor" → fixed with `function` impls; plus a `setInterval`-spy infinite recursion (`.bind`-captured "real" resolved to a prior test's spy) → fixed by capturing pristine native `setInterval` at module scope + `afterEach` restore. (2) Vitest 4 `restoreAllMocks()` no longer clears `vi.mock`-factory `vi.fn()` call history → `attemptSilentRefresh` counts leaked across `TokenRefresh` tests → fixed with `vi.clearAllMocks()` in `beforeEach` (confirmed a leak artifact, not a real scheduling bug). Verified: vite build green, vitest 488/488, eslint clean. Frontend-only; deploy-time neutral. Learning: **don't `prettier --write` whole files in a dep bump** — these test files were pre-existing non-conformant and prettier churned ~800 lines; the hook doesn't enforce prettier, so keep the diff to the fix. Original entry kept below for context.

**Urgency: Medium.** Vite is two majors behind.

**What:** bump `vite` `^5` → `^7`, `vitest` `^2` → `^4`, and `@vitejs/plugin-react` to its Vite-7-compatible major **together**; reconcile `vite.config`/`vitest` config; run `npm run build` + `vitest run` + the full Vitest/RTL suite.

**Why:** Vite 7 is newest stable (8 is beta → avoid); Vitest 4 is GA (v3 is backport-only maintenance). **Vite and Vitest majors must move in one PR** — mismatched majors break the runner.

**Constraints:** requires Node ≥20.19/22.12 → **gated on T1**. Isolate in its own PR (don't combine with T3) so a regression points at one change.

**Raised in:** Dependency upgrade audit, 2026-06-11.
**Depends on:** **T1** (Node bump). Blocks T3 (sequence, not hard-block).

---

## TI-30. React 18 → 19 (dep-audit T3)

✅ **Done** (PR #246, deploy #536, 2026-06-11). `react`/`react-dom` `^18.3.1 → ^19.2.7`; `@types/react` `^18.3.12 → ^19.2.17`, `@types/react-dom` `^18.3.1 → ^19.2.3`. Lockfile regenerated incrementally on Node 24 / npm 11.13.0. **Zero code changes** — a pre-migration scan found no React-19 breaking patterns: `createRoot` already in use (no legacy `ReactDOM.render`), no string refs, no component `defaultProps`, no `propTypes`/`findDOMNode`/legacy-context/`forwardRef`. No codemod needed. Single deduped `react@19.2.7` (no duplicate instance); all peer deps already declared `^18 || ^19`. Verified: vite build green; `tsc -b` clean; `tsc -p tsconfig.test.json` clean (test typecheck — required after a `@types/*` major); vitest 488/488; eslint clean. Frontend-only; deploy-time neutral. Prod bundle grew ~1005 → 1056 kB (React 19 runtime) — deferred to the 19-I2 bundle-budget gate. Original entry kept below for context.

**Urgency: Medium.**

**What:** `react`/`react-dom` `^18.3.1` → `^19.2.x`; `@types/react`/`@types/react-dom` `^18` → `^19`; run the `codemod` react-18→19 transforms; audit removed legacy APIs (string refs, function-component `defaultProps`, legacy context).

**Why:** React 19 is stable and widely adopted by mid-2026; already on `18.3.1` (the React-team-recommended pre-19 step ✅). All peer deps (Tiptap, react-query, react-router, testing-library v16) already declare `^18 || ^19` — **unblocked**.

**Constraint:** sequence after T2 and isolate in its own PR (don't move Vite and React together).

**Raised in:** Dependency upgrade audit, 2026-06-11.
**Depends on:** T2 (sequencing).

---

## TI-31. TypeScript 5.6 → 6.0 (dep-audit T4)

✅ **Done** (PR #249, deploy #539, 2026-06-11). `typescript ^5.6.3 → ^6.0.3`; `typescript-eslint ^8.59.2 → ^8.61.0` (peers `typescript <6.1.0` → 6.0 in range; eslint peer covers ESLint 10). Lockfile regenerated on Node 24 / npm 11.13.0. **One migration step:** TS 6.0 raises `baseUrl` to a deprecation **error** (TS5101, removed in TS 7.0). Fixed by **removing `baseUrl` from `tsconfig.app.json`** rather than silencing with `ignoreDeprecations` — the `@/*` paths value (`./src/*`) is `./`-relative so it resolves relative to the tsconfig dir (TS 4.1+), identical resolution; `tsconfig.test.json` extends app and inherits it; the lone `@/` import (`main.tsx`) and the independent Vite alias both still resolve. **⚠️ Do not re-add `baseUrl`** to support a non-`@/` bare import — it reintroduces the TS5101 deprecation; use an explicit relative or `@/` path instead. Verified: `tsc -b` clean, `tsc -p tsconfig.test.json` clean, vite build green, vitest 490/490, eslint clean (typed-lint under TS 6). Frontend-only; deploy-time neutral. **This closes the 2026-06 dependency upgrade audit** — every High/Medium item (T1/T7/T2/T3/T4) is done. Original entry kept below for context.

**Urgency: Medium.**

**What:** `typescript` `^5.6.3` → `^6.0`; run `tsc -b` + `tsc -p tsconfig.test.json` (CI typechecks tests via a separate config — CLAUDE.md guardrail). Bump `typescript-eslint` to its latest TS-6-compatible release in the same PR.

**Why:** 6.0 is stable (Mar 2026); 7.0 (the Go rewrite) is still beta → avoid. typescript-eslint peer caps at `<6.1.0`, so 6.0 is in range and 7.0 would not be — bump typescript-eslint alongside (overlaps the _ESLint `jsx-a11y`_ item's typed-lint follow-up).

**Raised in:** Dependency upgrade audit, 2026-06-11.
**Depends on:** — (pair with the typescript-eslint bump in the _ESLint jsx-a11y_ item).

---

## TI-32. Prime the ASP.NET request pipeline before the SnapStart snapshot (first request after restore pays ~7 s warmup)

**Draft slice — biggest single API-latency win.** SnapStart restores in ~0.5 s, but the **first request to hit a restored execution environment spends ~7 s in `Invocation` before any handler work runs** — .NET JIT, assembly load, DI-scope build, and ASP.NET routing/serializer warmup that the snapshot never captured. The snapshot is taken at the end of init, *before any request exercises the pipeline*, so first-request cost is paid live, per environment.

**Evidence (prod X-Ray, account 642653037268, eu-west-2, 2026-06-12):** a page load fanned out ~6 concurrent GETs; each forced a fresh restored environment and each took **~8.3–8.9 s**. Per-trace breakdown:

| Phase | note-detail GET | tagindex GET (near-empty handler) |
| --- | --- | --- |
| Restore (SnapStart) | 515 ms | 455 ms |
| **Invocation → first DynamoDB call** | **6.62 s (unaccounted)** | **6.92 s (unaccounted)** |
| DynamoDB | 0.84 s | 0.76 s |
| Post-query → response | 0.76 s | — |
| A later *warm* invocation | **1.26 s** | — |

The `tagindex` control (essentially one DynamoDB query) burns the same ~7 s, proving the cost is framework/runtime warmup, **not** handler logic, the query, or an external call — the gap sits at the very start of `Invocation`, before the first DynamoDB call is issued.

**Why it matters:** every cold-ish page load is ~8 s instead of ~1.3 s, multiplied by the page's concurrent fan-out (each parallel request lands on its own fresh environment, so they don't share the warmup). TI-13 already tuned SnapStart *cost* (512 → 256 MB) but did not touch first-request *latency*; this is the unaddressed half. Lower memory = less restore vCPU, so priming and the 256 MB setting interact — measure together.

**Fleet confirmation (CloudWatch Logs Insights, 24 h, 650 invocations, 2026-06-13):** the cost is cold-start-only and the warm path is healthy — the two populations split cleanly by presence of a `Restore Duration` in the REPORT line:

| Population | Count | Share | p50 | p90 | avg | max |
| --- | --- | --- | --- | --- | --- | --- |
| Warm | 591 | 91 % | 132 ms | 517 ms | 270 ms | 5.4 s |
| Cold (SnapStart) | 59 | **9 %** | 7.92 s | 10.0 s | 7.56 s | 13.9 s |

Restore itself averages 457 ms; the remaining ~7.1 s is post-restore JIT + first-use init. Cold starts are spread across nearly every active hour (idle-environment reclaim, not deploys), so ~1 in 11 interactions pays ~8 s.

**Fix (shipped on branch `tech/snapstart-cold-start`, 2026-06-13):** register a `BeforeSnapshot` hook (`Amazon.Lambda.Core.SnapshotRestore.RegisterBeforeSnapshot`) so the snapshot captures a JIT'd, warm process. `Builder.RegisterSnapStartPriming(app)` is called in `Program.cs` before `app.Run()` and, guarded on `AWS_LAMBDA_FUNCTION_NAME` (no-op off-Lambda), runs at snapshot creation:

1. Resolves a DI scope and runs the DynamoDB health check — warms the AWS SDK credential-provider chain + DynamoDB marshallers + HTTP/JSON machinery (the JIT survives into the snapshot; only the TLS connection is re-established post-restore).
2. Serializes a representative nested object with System.Text.Json — warms the STJ converter factory + metadata cache, which ReadyToRun does **not** cover.

Broad framework/SDK/our-assembly JIT is handled by the paired **TI-35** (ReadyToRun). A full in-process middleware-pipeline request (`TestServer`) was considered (item 4 in the original plan) but deferred — `AddAWSLambdaHosting` exposes no loopback handler, and TI-35 already AOT-compiles the routing/auth path; revisit only if the post-deploy trace shows a material residual gap.

**Acceptance criteria:**
- First-invocation-after-restore `Invocation` time (minus downstream subsegments) drops from ~7 s toward the warm ~1.3 s, measured on a real post-deploy X-Ray trace **and** the cold-population p50 in the CloudWatch split above.
- Restore duration stays within the TI-13 watch band (bump 256 → 384 MB only if restore latency climbs materially with the extra snapshot work).
- No behaviour change to any endpoint; priming is init-only, best-effort (`try/catch`), and idempotent.

**Deploy-time delta:** priming runs during the SnapStart snapshot publish, already paid on every backend deploy (~137 s per TI-22). Adds **a few seconds, one-off per backend deploy** — flag and accept per the deploy-time guardrail; frontend-only deploys skip the publish. (TI-35 adds the larger, separately-flagged R2R publish cost.)

**Related:** the frontend also fans out ~6 concurrent GETs on note open — collapsing those into fewer aggregate reads would cut how many fresh environments a single page load forces. Track separately if priming + R2R don't close it.

**Raised in:** Prod latency investigation, 2026-06-12 (X-Ray); fleet split added 2026-06-13 (CloudWatch).
**Depends on:** — (interacts with TI-13 memory setting; pairs with TI-35).

---

## TI-33. `NoteCardList` reads via full-table `Scan` with `ConsistentRead`, not a per-user/workspace GSI + `Query`

`DynamoDbNoteCardListStore.QueryAllAsync` (`src/EventStore/Projections/DynamoDbNoteCardListStore.cs:57`) does a **paginated full-table `Scan` with `ConsistentRead = true`**, then sorts client-side by `CreatedAt`. It backs the notes-list GET. Same anti-pattern as **TI-20** (`WorkspaceList`), on the larger and faster-growing table.

**Evidence (prod X-Ray, 2026-06-12):** `Scan` on `notetaker-proj-notecardlist`, `scanned_count` 234, `content_length` 73,988, `ConsistentRead = true` → **840 ms** — and the count, latency, and read cost all grow O(all notes across all users).

**Two issues, both growing:**
1. **`Scan`, not `Query`** — reads the entire projection every request rather than a partition-keyed slice. The precedent fix (`NoteSearchView`) uses a `UserId-index` GSI + `Query`.
2. **`ConsistentRead = true` on a `Scan`** — doubles read cost + latency vs eventually-consistent and forbids serving the read off a GSI. The single-item path (`GetByNoteAsync`, line 50) also uses `ConsistentRead = true`. Check whether the *list* read genuinely needs strong consistency: post-27 the API reads projections the async Projector Lambda builds, and read-your-writes is handled by the `ConsistencyGate` polling the proj-position table — if the gate already guarantees freshness, the strong-consistent Scan is redundant cost. The single-entity RYW need (RYW-1) does not imply the whole-list read needs it.

**Fix:** add a `UserId` (or `WorkspaceId`) GSI to `notetaker-proj-notecardlist`; switch the list read to a per-user/workspace `Query`; drop `ConsistentRead` on the list path unless the gate analysis shows it is load-bearing. Fold into Phase 23's scoping work alongside TI-20 (same change shape, same table family) — doing both together amortises the GSI-backfill + rebuild.

**Raised in:** Prod latency investigation, 2026-06-12 (X-Ray trace analysis).
**Depends on:** — (pairs with TI-20; fold into Phase 23).

---

## TI-34 — Make Lambda naming specific & correct everywhere

**What:** Audit every reference to "Lambda" / "the function" across CDK ids, `CLAUDE.md`, ADRs, phase docs, and code comments, and make each one specific to the function it means. There are now **two** Lambdas, so generic "the Lambda" is ambiguous.

**Correct names by era:**
- **Now (single API Lambda + async projector):** **API Lambda** (`ApiFunction` — handles all routes, command *and* query) and **Projector Lambda** (`ProjectorFunction` — async stream consumer).
- **After 27-D (Command/Query split):** **Command Lambda** + **Query Lambda** + Projector Lambda.

**Important:** do NOT rename the current single API Lambda to "Command Lambda" — the Command/Query split hasn't happened (27-C was reverted; only Todo is async via RYW-1). "Command/Query Lambda" is correct only as *target* wording in ADR 0009 / phase-27, not for the current single-Lambda state. Any place using the future-split names to describe the present should be corrected to "API Lambda".

**Why:** ambiguity now that there are two functions; future-split names used for the present state mislead.
**Raised in:** user request, 2026-06-12.
**Depends on:** — (the Command/Query half lands naturally with 27-D).

---

## TI-35. ReadyToRun-publish the API Lambda — AOT-precompile to cut first-request JIT after a SnapStart restore

The ~7.1 s post-restore warmup (see TI-32) is dominated by .NET JIT of code the snapshot never exercised. **ReadyToRun (R2R)** AOT-precompiles IL to native images at publish time, so the first request runs precompiled code instead of JIT-compiling it live. R2R is the AWS-recommended companion to SnapStart for .NET and is orthogonal to the TI-32 priming hook: priming captures *first-use init* (SDK marshallers, STJ metadata, credential chain) into the snapshot; R2R removes the *JIT* of our assemblies + the heavy NuGet dependencies (AWS SDK, `JwtBearer`, Google API libs) that priming alone doesn't reach.

**Fix (shipped on branch `tech/snapstart-cold-start`, 2026-06-13):**
1. `src/Api/Api.csproj` — `<PublishReadyToRun>true</PublishReadyToRun>` inside a `Condition="'$(RuntimeIdentifier)' != ''"` PropertyGroup, so R2R activates **only** when a RID is supplied. Plain `dotnet build` / `dotnet test` / the local `cdk synth` publish stay portable IL — no impact on dev machines or test runs.
2. `.github/workflows/deploy.yml` (both `deploy-test` + `deploy-production`) and `pr.yml` — the API publish gains `-r linux-x64 --self-contained false`. Framework-dependent (Lambda's `DOTNET_10` managed runtime provides the shared framework); the GitHub `ubuntu` runner is `linux-x64`, matching the x86_64 Lambda, so crossgen runs natively. `-o` keeps the asset path `Code.FromAsset` expects.

**Verified:** `PublishReadyToRun` evaluates `true` only with a RID; a clean publish clears `COMIMAGE_FLAGS_IL_ONLY` on `Api.dll`, `AWSSDK.DynamoDBv2.dll`, and `JwtBearer.dll` (= native R2R images); no runtime shipped (framework-dependent). 362 in-process API tests + 105 infra-assertion tests green.

**Acceptance criteria:**
- Same as TI-32: cold-population p50 drops materially vs the CloudWatch split; verify on a post-deploy X-Ray trace.
- No behaviour change; the deployed artefact stays framework-dependent on the managed runtime.

**Deploy-time delta:** R2R crossgen adds **~30–90 s to each backend API publish — recurring, every backend deploy** (not one-off). This needs explicit accept per the deploy-time guardrail. Justified: it buys a ~7 s cut on ~9 % of all user requests. Frontend-only deploys are unaffected (publish skipped). Projector Lambda left on IL (async, cold start not user-visible) — revisit if its cold start ever matters.

**Raised in:** Prod latency investigation, 2026-06-13.
**Depends on:** — (pairs with TI-32; both ship together).
