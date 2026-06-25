# Dependency Upgrade Audit — June 2026

**Goal:** One-pass review of every package, tool, framework, and runtime; recommend upgrades on a **long-term-support / not-bleeding-edge** basis; record constraints and ordering; output an ordered task backlog.

Audited 2026-06-11. Targets are the latest **GA** release of the **current stable major** — never a beta/RC, never a just-released next major.

## Task backlog (ordered)

| # | Task | Type | Risk | Depends on | Urgency |
|---|------|------|------|------------|---------|
| T1 | CI Node 20 → 24 LTS + `@types/node` + lockfile | Frontend/CI | Low | — | **High (EOL)** |
| T2 | Vite 5 → 7 + Vitest 2 → 4 (move together) | Frontend | Med | T1 | Med |
| T3 | React 18 → 19 (+ `@types/react*`, codemods) | Frontend | Med | T2 | Med |
| T4 | TypeScript 5.6 → 6.0 | Frontend | Med | — (pair w/ T5) | Med |
| T5 | Lint/dev-tooling minor batch (eslint, typescript-eslint, prettier-config, lint-staged, msw, jsdom, globals, testing-library) | Frontend | Low | T4 | Low |
| T6 | Tiptap 3.23.4 → 3.26.0 (all `@tiptap/*` lockstep) | Frontend | Low | — | Low |
| T7 | ASP.NET 10 servicing patches + AWS SDK patch bumps | Backend | Low | — | **High (security)** |
| T8 | AWS CDK 2.254.0 → 2.258.0 + Constructs | Infra | Low-Med | — | Low |
| T9 | Microsoft.Playwright 1.50.0 → 1.60.0 | Test/CI | Low-Med | — | Low |
| T10 | xUnit v2.9.3 → v3 across all 8 test projects | Test | High | — | Low (v2 security-patched) |

T1→T2→T3 is a strict chain (do not combine into one PR — isolate failure causes). T4/T5 pair. T6, T7, T8, T9, T10 are independent and can run in parallel with the chain.

## Current state vs. target

### Runtime / framework

| Component | Current | Latest stable | Target | Note |
|-----------|---------|---------------|--------|------|
| .NET | net10.0 (LTS) | 10.0.x (LTS) | **no action** | Already on the LTS (support to Nov 2028). SDK floats `10.0.x` in CI. ✅ |
| Node.js (CI + local) | 20 | 24 (Active LTS), 22 (Maint LTS) | **24** | Node 20 **EOL 30 Apr 2026 — already past**. 24 = longest runway (to Apr 2028). |
| React | 18.3.1 | 19.2.7 | **19.2.x** | On 18.3.1 = the React-team-recommended pre-19 step. ✅ ready. |
| TypeScript | 5.6.3 | 6.0 (7.0 beta) | **6.0** | 7.0 = Go rewrite, still beta → avoid. |

### Frontend build / test toolchain

| Component | Current | Latest stable | Target | Note |
|-----------|---------|---------------|--------|------|
| Vite | ^5.4.10 | 7.3.x (8.0 beta) | **7** | Requires Node ≥20.19 / ≥22.12 → gated on T1. |
| Vitest | ^2.1.9 | 4.1.x (v3 maint-only) | **4** | Major must track Vite; v3 is backport-only. |
| @vitejs/plugin-react | ^4.3.3 | latest | bump w/ Vite 7 | Must match Vite 7. |
| ESLint | ^10.3.0 | 10.4.1 | 10.4.x | v9 EOL 2026-08-06; already on 10. ✅ minor. |
| typescript-eslint | ^8.59.2 | latest 8.x/9.x | latest | Must support TS 6.0 (peer caps `<6.1.0`) + ESLint 10. |
| eslint-config-prettier | ^9.0.0 | 10.x | 10 | Minor. |
| lint-staged | ^14.0.0 | 16.x | latest | Minor dev tool. |
| msw / jsdom / globals / @testing-library/* | various | latest | latest | Low-risk batch (T5). |

### Frontend libraries

| Component | Current | Latest stable | Target | Note |
|-----------|---------|---------------|--------|------|
| @tiptap/* | 3.23.4 | 3.26.0 | **3.26.0** | Minor within v3. `@tiptap/extension-image` is **pinned `3.23.4` (no caret)** — bump in lockstep or ProseMirror version skew breaks. |
| react-router | ^7.17.0 | 7.x | no action | Current major. ✅ |
| @tanstack/react-query | ^5.101.0 | 5.x | no action | Current major. ✅ |
| @aws-sdk/client-transcribe-streaming | ^3.1050.0 | 3.x | floats | Caret tracks v3 patches. ✅ |

### Backend packages

| Component | Current | Latest stable | Target | Note |
|-----------|---------|---------------|--------|------|
| Microsoft.AspNetCore.Authentication.JwtBearer | **10.0.0** | 10.0.9 | **10.0.9** | **9 servicing patches behind, incl. security.** Pinned exact — does not float. |
| Microsoft.AspNetCore.Mvc.Testing | 10.0.8 | 10.0.9 | 10.0.9 | Align with JwtBearer to same servicing level. |
| Amazon.Lambda.AspNetCoreServer.Hosting | 2.0.0 | 2.1.0 | 2.1.0 | Minor. |
| AWS.Lambda.Powertools.Logging/Metrics | 3.2.2 | 3.2.2 | no action | Latest. ✅ |
| AWSSDK.* (Bedrock, S3, DynamoDBv2, STS, SSM, Setup) | 4.0.x | 4.0.x (newer patch) | latest 4.0.x | v4 = current major; routine patch bumps, batch. |
| AWSXRayRecorder.Handlers.AwsSdk | 2.14.0 | check | latest 2.x | Low priority. |
| Google.Apis.Calendar.v3 | 1.74.0.4073 | check | latest 1.x | Routine. |
| Amazon.CDK.Lib | 2.254.0 | 2.258.0 | 2.258.0 | Deploy-path change — see T8. |
| Constructs | 10.6.0 | 10.x | latest 10.x | Pair with CDK. |

### Test stack

| Component | Current | Latest stable | Target | Note |
|-----------|---------|---------------|--------|------|
| xunit | 2.9.3 | v3 (3.2.2) | v3 (T10) | v2.9.3 = **security-only**; v3 stable since 2025. Big migration. |
| xunit.runner.visualstudio | 3.1.4 | latest | bump w/ T10 | v3 runner needed for xUnit v3. |
| Microsoft.NET.Test.Sdk | 18.5.1 | latest | latest | Bump alongside test changes. |
| Microsoft.Playwright | 1.50.0 | 1.60.0 | **1.60.0** | Keep CI `playwright.ps1 install` + cache key aligned. |
| Testcontainers.DynamoDb | 4.11.0 | latest 4.x | latest 4.x | Routine. |
| coverlet.collector | 6.0.4 | latest | latest | Routine. |
| Xunit.SkippableFact | 1.4.13 | — | replace in T10 | Likely no xUnit-v3 support → migrate to native `Assert.Skip` (v3). |

### GitHub Actions

| Action | Current | Note |
|--------|---------|------|
| actions/checkout | v6 | Current. ✅ |
| actions/setup-node | v6 | Current — but **`node-version: "20"` is the real issue (T1)**, not the action. |
| actions/setup-dotnet | v5 | Current. ✅ |
| actions/cache | v5 | Current. ✅ |
| actions/upload-artifact | v7 | Current. ✅ |
| aws-actions/configure-aws-credentials | v6 | Current. ✅ |
| dorny/paths-filter | v3 | Current. ✅ |

GitHub Action majors are all current — no action beyond the Node *runtime* version in T1.

## Constraints & ordering rules

1. **Node before Vite.** Vite 7 requires Node ≥20.19 / ≥22.12. T1 must land before T2.
2. **Regenerate `package-lock.json` on the target Node version** (per CLAUDE.md guardrail) — a lockfile cut on Node 24/npm 11 omits entries Node 20's npm needs, and vice-versa. Since CI moves to Node 24, generate the lockfile on Node 24 in the same PR.
3. **Vite and Vitest majors move together** — mismatched majors break the test runner. One PR.
4. **Isolate the frontend chain** — T1, T2, T3 each in their own PR so a regression points at one change, not three.
5. **TS 6.0 ≤ typescript-eslint cap.** typescript-eslint peer is `typescript >=4.8.4 <6.1.0` — 6.0 is in range; 7.0 would not be. Bump typescript-eslint (T5) alongside or before TS 6.0.
6. **React peers already satisfied** — Tiptap, react-query, react-router, testing-library all declare `^18 || ^19`. React 19 is unblocked.
7. **Tiptap lockstep** — every `@tiptap/*` must be the same version; the exact-pinned `extension-image` must move with the rest.
8. **CDK bump is a deploy-path change** (guardrail) — isolate T8, run `cdk synth` + `cdk diff`, check `Infrastructure.Assertions`, and state the deploy-time delta in the PR. Bumping CDK lib can alter synthesized templates → review the diff before merge.
9. **xUnit v3 is structural** — test projects change from class libraries to executables; needs the v3 runner + Microsoft.Testing.Platform; assertion API is a superset (possible conflicts). `Xunit.SkippableFact` likely has no v3 build → replace its uses (`Api.Smoke`, `Analysis.Eval`) with v3-native `Assert.Skip`. Do last, one project at a time.
10. **Playwright browser version** — bumping the NuGet package changes the bundled browser; the CI install step (`playwright.ps1 install --with-deps chromium`) and its cache key must stay aligned.

## No action needed (already LTS / current)

- .NET 10 (LTS to Nov 2028)
- AWS.Lambda.Powertools 3.2.2 (latest)
- react-router 7, @tanstack/react-query 5 (current majors)
- AWS SDK for .NET v4 major, AWS SDK JS v3 major (caret-tracked)
- All GitHub Action majors

## Ordered task detail

1. **T1 — Node 20 → 24 LTS.** `node-version: "20"` → `"24"` in `deploy.yml` (3 sites) + `pr.yml` (2 sites); `@types/node` `^20` → `^24`; regenerate `package-lock.json` on Node 24. *Rationale:* Node 20 is past EOL (30 Apr 2026) — CI runs unsupported; 24 is Active LTS (to Apr 2028). Unblocks T2. Low risk (build-tooling only; Lambda runtime is .NET).
2. **T2 — Vite 7 + Vitest 4.** Bump `vite`, `vitest`, `@vitejs/plugin-react` together; reconcile `vite.config`/`vitest` config; run `npm run build` + `vitest run`. *Rationale:* Vite 5 two majors behind; 7 is newest stable (8 beta). Vitest 4 GA (v3 maintenance-only).
3. **T3 — React 19.** `react`/`react-dom` → 19.2.x; `@types/react`/`@types/react-dom` → 19; run `codemod` react-18→19; audit removed legacy APIs (string refs, function-component `defaultProps`, legacy context). *Rationale:* 19 stable & widely adopted by mid-2026; peers ready; already on the recommended 18.3.1 pre-step.
4. **T4 — TypeScript 6.0.** `typescript` `^5.6.3` → `^6.0`; run `tsc -b` and `tsc -p tsconfig.test.json`. *Rationale:* 6.0 stable (Mar 2026); 7.0 beta avoided.
5. **T5 — Lint/dev-tooling batch.** ESLint 10.4.x, typescript-eslint latest (TS-6-compatible), eslint-config-prettier 10, lint-staged 16, msw/jsdom/globals/testing-library latest. *Rationale:* low-risk hygiene; typescript-eslint must align with TS 6 (so after/with T4).
6. **T6 — Tiptap 3.26.0.** All `@tiptap/*` to 3.26.0 incl. the pinned `extension-image`. *Rationale:* stay current within v3; low risk.
7. **T7 — ASP.NET servicing + AWS SDK patches.** JwtBearer 10.0.0 → 10.0.9, Mvc.Testing → 10.0.9, AspNetCoreServer.Hosting 2.1.0, AWSSDK.* → latest 4.0.x, X-Ray/Google.Apis routine. *Rationale:* **JwtBearer is 9 servicing patches behind on an auth-critical, exact-pinned package** — highest backend priority. Batch the rest.
8. **T8 — CDK 2.258.0 + Constructs.** Bump; `cdk synth` + `cdk diff`; verify `Infrastructure.Assertions`; state deploy-time delta. *Rationale:* stay current; deploy-path change → isolate and review the template diff.
9. **T9 — Playwright 1.60.0.** Bump NuGet; align CI browser install + cache key; run `Browser.E2E`. *Rationale:* 10 minors behind; low-medium risk.
10. **T10 — xUnit v3 migration.** All 8 test projects → executables + v3 runner + Microsoft.Testing.Platform; replace `Xunit.SkippableFact` with `Assert.Skip`; one project per PR. *Rationale:* v2.9.3 is security-only; v3 is the maintained line. Largest effort, lowest urgency — schedule last.

## Sources

- [Node.js releases / EOL](https://nodejs.org/en/about/previous-releases) · [endoflife.date/nodejs](https://endoflife.date/nodejs)
- [Vite 7 announcement](https://vite.dev/blog/announcing-vite7) · [Vite releases](https://vite.dev/releases)
- [Vitest releases](https://github.com/vitest-dev/vitest/releases) · [Vitest 3](https://vitest.dev/blog/vitest-3)
- [React versions](https://react.dev/versions) · [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
- [.NET 10 support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) · [Announcing .NET 10](https://devblogs.microsoft.com/dotnet/announcing-dotnet-10/)
- [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)
- [xUnit v3 migration](https://xunit.net/docs/getting-started/v3/migration) · [xUnit releases](https://xunit.net/releases/)
- [Microsoft.Playwright 1.60.0](https://www.nuget.org/packages/microsoft.playwright)
- [ESLint v10.0.0 released](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/) · [ESLint version support](https://eslint.org/version-support/)
- [Amazon.CDK.Lib 2.258.0](https://www.nuget.org/packages/Amazon.CDK.Lib/)
- [@tiptap/react](https://www.npmjs.com/package/@tiptap/react)
- [JwtBearer 10.0.9](https://www.nuget.org/packages/Microsoft.AspNetCore.Authentication.JwtBearer) · [AspNetCoreServer.Hosting 2.1.0](https://www.nuget.org/packages/Amazon.Lambda.AspNetCoreServer.Hosting/)
- [Powertools .NET](https://www.nuget.org/packages/AWS.Lambda.Powertools.Logging/)
