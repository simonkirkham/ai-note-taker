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

## ESLint `jsx-a11y` (blocked on ESLint 10) + `import` rules follow-up + `@/` alias

**Status of the three originals (Phase 14):**
- **`@/` path alias** — ✅ **Done** (Phase 14-Q): `resolve.alias` in `vite.config.ts` + tsconfig `paths`.
- **Import ordering** — ✅ **Done** (Phase 14-R), but via **`eslint-plugin-import-x`** (the maintained, flat-config-native fork), NOT `eslint-plugin-import` — the latter peer-caps at ESLint 9 and the project is on **ESLint 10**. Only `import-x/order` was enabled.
- **`eslint-plugin-jsx-a11y`** — ⛔ **BLOCKED / deferred** (Phase 14-S/T): `eslint-plugin-jsx-a11y@6.10.2` peer-caps at ESLint 9, no ESLint 10 support. Forcing it via `--legacy-peer-deps` would risk the lint gate, so it was deferred.

**Remaining work (this item):**
1. **`jsx-a11y` once it supports ESLint 10** — add in `warn` mode, triage the a11y backlog, promote to `error` (the deferred 14-S/14-T). Re-check the plugin's peer range periodically, or adopt an ESLint-10-compatible a11y plugin if one emerges first.
2. **`import-x/no-unresolved` + `import-x/no-cycle`** — the original AC also named "catch unresolved/circular imports", which 14-R did not enable (needs `eslint-import-resolver-typescript` wired for the `@/` alias; `no-cycle` can be noisy). Add these on a follow-up pass.
**Why it matters:** a11y and import-hygiene enforcement turn "please remember" into "the build fails if you don't." `react-hooks` + `import-x/order` are now active; this closes the remaining gaps.
**Raised in:** Frontend standards review 2026-06-03; updated after Phase 14-Q/R/S/T (ESLint-10 plugin-ecosystem gap discovered).
**Depends on:** `jsx-a11y` shipping ESLint 10 support (external). The import rules are unblocked.

---

## Migrate `App.css` to CSS Modules

**What:** Retire the single 2853-line global stylesheet `web/src/App.css` in favour of co-located CSS Modules (`Component.module.css`), the adopted standard (see [docs/react-coding-standards.md](react-coding-standards.md) and the `frontend-react` skill). Concretely: (1) extract the `:root` design tokens and every `[data-theme]` theme block into `web/src/styles/tokens.css` (and **add a `--space-*` spacing scale** while there — none exists today), and the reset/base-element rules into `web/src/styles/global.css`, imported once at the app root; (2) for each component, move its rules into a co-located `*.module.css`, convert class names to `camelCase`, swap JSX `className` strings to `styles.*`, and use `clsx` for conditional classes; (3) delete migrated (and dead) selectors from `App.css` until the file is empty and removed. New/changed components already follow the module standard — this item is the bulk migration of existing components.
**Why it matters:** The global namespace has no scoping — collisions and dead selectors accumulate, and a 2853-line file is hard to navigate and safely change. Modules give automatic scoping, co-location with the owning component, and obvious dead-code detection, with no new runtime dependency (Vite supports modules natively). Theming via CSS custom properties is preserved unchanged.
**Raised in:** Frontend standards update, 2026-06-02. Decision: CSS Modules, incremental migration with a near-term dedicated full-migration effort.
**Depends on:** Nothing blocking. Best done component-by-component (each migration is independently shippable); regression-checked by the existing Vitest/RTL suite and `Browser.E2E` journeys. Add `clsx` to `web/` deps on the first migration PR.

---

## Upgrade GitHub Actions to Node.js 24

**What:** Update `actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact`, and `aws-actions/configure-aws-credentials` to versions that run on Node.js 24. Alternatively set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in workflows as a quick opt-in to verify nothing breaks, then pin updated action versions.
**Why it matters:** Node.js 20 actions are deprecated; GitHub forces Node.js 24 by default from 2026-06-02 and removes Node 20 from runners on 2026-09-16. Will break CI if ignored.
**Raised in:** Phase 6 / adhoc CI observation.
**Depends on:** Nothing blocking. Confirm updated major versions exist for each action before upgrading.

---

## Resolve ESLint warnings in `web/src/auth/AuthContext.tsx`

**What:** `validate-frontend` emits three ESLint warnings against `web/src/auth/AuthContext.tsx`:
- **L15 — `react-refresh/only-export-components`:** the file exports the `AuthContext` object alongside components — move the React context to its own file.
- **L182 — `react-refresh/only-export-components`:** the file also exports the `useAuth` hook alongside components — move shared hooks/constants out so the file only exports components, restoring Fast Refresh.
- **L155 — `react-hooks/exhaustive-deps`:** the OAuth-exchange `useEffect` has an empty dependency array but reads `clientId` and `initialToken`. This is **intentional** (it must run once on mount, guarded by `mounted.current`) — resolve by either adding the deps with a guard that preserves run-once semantics, or an explicit `eslint-disable-next-line` with a comment explaining why, so the warning stops masking real ones.

Suggested split: extract `AuthContext` (and `useAuth`) into `web/src/auth/authContext.ts`, leaving `AuthProvider` as the only export of `AuthContext.tsx`.
**Why it matters:** Fast Refresh silently degrades to full reloads for any file importing from this module, slowing local dev. Standing lint warnings also erode the signal — a genuine new warning is easy to miss in the noise. Neither warning changes runtime behaviour.
**Raised in:** CI annotation review, 2026-06-02 (`validate-frontend`).
**Depends on:** Nothing blocking. Re-run `npm --prefix web run lint` after the split to confirm zero warnings; the auth flow is well covered by `TokenRefresh.test.tsx` / `ApiFetch.test.ts`.

---

## Investigate whether CDK synth needs real AWS credentials in `validate.yml`

**What:** If the CDK app does no context lookups (SSM, VPC resolution, etc.), `cdk synth` can run without credentials. If confirmed, remove the `Configure AWS credentials` step and `environment: Test` from `validate.yml` — validate becomes a pure code-quality gate with no AWS dependency.
**Why it matters:** Removes an unnecessary AWS dependency from the PR-validation path, simplifying CI and reducing the blast radius of credential issues.
**Raised in:** CI / Dev Experience observation.
**Depends on:** Confirm the CDK app performs no environment-bound context lookups during synth.

---

## Add `cdk synth` to the pre-commit hook

**What:** The pre-commit hook builds, lints, typechecks, and runs the test suites, but does **not** run `cdk synth`. Add it so the local gate matches the guardrail "Never commit without all BDD specs green and `cdk synth` succeeding." Note `cdk synth` requires a prior `dotnet publish` of the API, so factor that into the step.
**Why it matters:** The hook otherwise lets through commits that break CDK synthesis, which then fail later in CI/deploy.
**Raised in:** Spun off from the now-resolved stale-test-paths fix (840464b) — that change corrected the hook's project paths and removed the leftover empty test dirs, but left the `cdk synth` suggestion unactioned.
**Depends on:** Nothing blocking. Decide whether the `dotnet publish` cost is acceptable in a pre-commit gate.

---

## Remove (or wire up) the dead `IDomainEventDispatcher` / `IDomainEventHandler` infrastructure

**What:** `IDomainEventDispatcher` and every `IDomainEventHandler` implementation (`TagIndexEventHandler`, `NoteDetailEventHandler`, `NoteTitleListEventHandler`, `NoteCardListEventHandler`, `TodoListEventHandler`) are registered in `Builder.cs` but **`DispatchAsync` is never called anywhere** in `src` or `tests` — confirmed by grep. They are dead code. Live projection updates actually happen **inline inside the command handlers** (`NoteCommandHandler.UpdateProjectionAsync` / `UpdateTagIndexForNewEventsAsync`, `ActionItemCommandHandler`'s inline upserts). Pick one direction and make the code and docs agree:
- **Option A (cleanup):** delete the dispatcher + the five unused `IDomainEventHandler` classes and their DI registrations; the inline-in-handler updates become the documented pattern.
- **Option B (restore the intended design):** call `IDomainEventDispatcher.DispatchAsync` from the command handlers after append and migrate each inline projection update into its `IDomainEventHandler`, deleting the inline blocks so projections aren't double-updated. (Effectively a down-payment on the async-projector split below.)

**Why it matters:** The dead infrastructure actively misleads. **CLAUDE.md** ("the handler … then calls `IDomainEventDispatcher.DispatchAsync` — that's it. Reacting to events … belongs in `IDomainEventHandler` implementations") and the "Split the single API Lambda" entry below ("updates all projections synchronously in-process **via `IDomainEventDispatcher`**") both describe an architecture the code does not use. This drift cost real time in slice 10-J: the phase-10 doc prescribed a `TagFeedbackEventHandler : IDomainEventHandler` mirroring `TagIndexEventHandler`, which would have been dead on arrival — the feedback projection had to be wired inline instead. The next projection slice (10-L) and anyone reading the architecture docs will hit the same trap.

**Raised in:** Slice 10-J implementation, 2026-06-02 — discovered while wiring the tag-feedback projection.
**Depends on:** Nothing blocking. Option B overlaps heavily with the async-projector split below; if that phase is imminent, prefer doing this as part of it (or pick Option A now to stop the bleeding and let the split re-introduce real handlers). Whichever is chosen, update CLAUDE.md and the CQRS entry's wording to match.

---

## Split the single API Lambda into individual Lambdas (CQRS + async projectors)

**What:** The backend currently runs as one `ApiFunction` Lambda (ASP.NET minimal API behind an HTTP API proxy) that handles every route and updates all projections **synchronously in-process** via `IDomainEventDispatcher` before returning the HTTP response. Move to a deployment shape that matches an event-sourced system, in two stages:

1. **Stage 1 — CQRS + async projectors (do first).** Split write from read into separate Lambdas, and move projection-building off the request path onto **DynamoDB Streams** (or EventBridge): a **Command Lambda** appends events only; a **Projector Lambda** (idempotent, replayable) rebuilds read models off the stream; a **Query Lambda** serves reads from projections.
2. **Stage 2 — per-context command Lambdas (when ready to take it on).** Split the command surface by bounded context (Note / Folder / Calendar / Transcription / Todo) into separate Lambdas for deploy and scaling isolation and tighter per-context IAM. Adopt incrementally, only where a context earns it (e.g. Transcription's different runtime profile) — not wholesale.

The full rationale, target diagrams, staged migration plan, and the eventual-consistency trade-off are in **[ADR 0009](adr/0009-split-lambdas-cqrs-async-projectors.md)**.

**Why it matters:** This is the defining event-sourcing deployment lesson for the project — an append-only log with decoupled, replayable async consumers — and it's the largest remaining ES learning surface (Streams, idempotency, replay, eventual consistency, async failure handling, DLQs/alarms). It also shrinks the write path and tightens per-Lambda IAM (today one role grants read/write on ~10 tables).

**Headline trade-off:** Stage 1 replaces today's immediate read-after-write consistency with **eventual** consistency (projector lags the write by stream latency, typically <1s). The frontend's optimistic updates already insulate the user, but server-side read-after-write — **smoke tests, E2E tests, and any read-after-append flow** — must move to retry/polling. Async projection failures also become invisible (DLQ + alarm) rather than a synchronous 500, so observability must be wired in the same slice.

**Raised in:** Architecture discussion, 2026-06-02 — desire to align the deployment with the event-sourced design.
**Depends on:** Nothing blocking. Pairs with the `observability` skill (async failure visibility). Best done as its own numbered phase given the breadth; graduate Stage 1 to a phase when picked up.

---

## Reduce Lambda SnapStart costs

**What:** Investigate and reduce the cost of Lambda SnapStart on the API function. SnapStart bills for the cache storage of each published version's snapshot and incurs a restore charge per cold start, on top of the init work captured in the snapshot. Options to evaluate: trim the number of published versions/aliases retained (delete stale ones so their snapshots stop accruing storage), confirm only versions actually routed to are kept warm, measure restore-time billing against the cold-start latency benefit, and check whether SnapStart is even net-positive for current traffic — if cold starts are rare, plain on-demand init may be cheaper.

**Why it matters:** SnapStart adds billing dimensions (snapshot cache storage + tiered restore charges) that are easy to leave unmanaged. Accumulating published versions each carry a snapshot, so cost creeps up silently as deploys pile up. Worth right-sizing before it becomes a noticeable line item.

**Raised in:** Cost-review observation, 2026-06-02.
**Depends on:** Nothing blocking. Pull SnapStart-related charges from Cost Explorer (filter the API Lambda) to quantify before acting. Confirm current SnapStart config in `src/Infrastructure/` CDK and how many versions are retained.

---

## Break down the monolithic `App.css` into a proper CSS architecture

**What:** `web/src/App.css` is a single **2,807-line** stylesheet that holds the styles for the entire frontend — sign-in, sidebar, folder tree, home list, note editor, to-do section, transcription UI, theme palettes (`:root` + every `[data-theme="…"]` block), notification banners, and more. Everything is global-scoped and edited by line-number reference (the doc entries throughout `phase-minor-changes.md` point at "~L821", "~L2057", etc.), which is brittle and makes it easy to clobber unrelated rules. Break it down into a maintainable structure and apply proper CSS practices. Options to weigh when picked up:
- **Split by concern into multiple files** imported from a small entry point — e.g. `tokens.css` (custom properties + theme palettes), `base.css`, and per-feature files (`sidebar.css`, `note-editor.css`, `todo.css`, `list-view.css`, `sign-in.css`, …), co-located with or near their components.
- **Move to CSS Modules** (Vite supports `*.module.css` out of the box) so each component owns scoped styles and class collisions become impossible — the biggest structural win, but the largest change.
- **Establish a token layer** as the single source of truth for colours/spacing/typography (the `--color-*` variables already exist; formalise spacing/radius/font tokens too) so feature files never hardcode values.
- Either way: introduce a consistent naming convention, group/region the rules, and remove dead/duplicated declarations found along the way.

**Why it matters:** A 2,800-line global stylesheet is a growing maintenance and correctness risk — every UI tweak risks an unintended cascade, line-number references in the planning docs rot as the file shifts, and there is no scoping to stop one feature's styles leaking into another. This is the frontend counterpart to the backend's structural hygiene; it lowers the cost and risk of every future UI slice (notably the queued home-screen tweaks CHANGE-8/9/10, which all edit this file). It is also a strong learning surface for CSS architecture (tokens, scoping strategies, CSS Modules vs. global).

**Raised in:** User request, 2026-06-02 — "review the app.css and break it down; it needs proper CSS skills."
**Depends on:** Nothing blocking. Best done as a behaviour-preserving refactor behind the existing component tests (no visual change intended) — snapshot/visual-diff or a careful manual pass to confirm nothing reskins. Sequence it **before or alongside** the home-screen tweaks (CHANGE-8/9/10) so they land on the new structure rather than the monolith. Given the breadth, consider graduating it to its own numbered phase when picked up.
