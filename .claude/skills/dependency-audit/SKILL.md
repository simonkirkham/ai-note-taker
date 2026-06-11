---
name: dependency-audit
description: Audit every package, tool, framework, runtime, and GitHub Action for available upgrades; recommend on a long-term-support (not bleeding-edge) basis; capture constraints + ordering; output an ordered task backlog, write a report, and graduate the High/Medium-urgency items into technical-improvements.md. Triggers include "dependency audit", "what can we upgrade", "review package versions", "upgrade report", "check for new versions".
---

# Dependency Audit

Produce a dated report of available upgrades across the whole stack, ranked for **long-term support, not bleeding edge**, with constraints and an ordered backlog — then graduate the High/Medium items into the work tracker.

**Default target for every component: the latest *GA* release of the *current stable major*.** Never a beta/RC. Never a just-shipped next major. On the LTS axis, prefer the version with the longest remaining support runway (e.g. Active LTS over Maintenance LTS).

## Step 1 — Inventory every manifest

Read the current pinned versions. Locations in this repo:

| Surface | Where |
|---------|-------|
| .NET projects | every `*.csproj` (`find . -name '*.csproj' -not -path '*/bin/*' -not -path '*/obj/*'`) — `TargetFramework` + every `PackageReference` |
| Frontend | `web/package.json` (deps + devDeps) and resolved pins in `web/package-lock.json` |
| CI runtimes + Actions | `.github/workflows/*.yml` — `node-version`, `dotnet-version`, every `uses:` action major |
| Tooling | `Makefile`, any `global.json`, composite actions under `.github/actions/` |

Record each as `component | current`. Note any **exact pins** (no `^`/`~`, or a fixed `X.Y.Z`) — they do **not** float and are the highest-value findings (e.g. a security patch sitting one pin away).

## Step 2 — Look up latest versions

For each component, find the latest **stable** version and its **major-version support status** (LTS dates, EOL). Use WebSearch — the registry/release pages are authoritative:

- npm: `npmjs.com/package/<name>` · NuGet: `nuget.org/packages/<name>`
- Runtimes/frameworks: vendor release + endoflife.date (Node, .NET, React, etc.)
- GitHub Actions: the action's releases page (check the runtime major, e.g. node24)

Batch the searches. Skip components already on the latest of their current major — mark them "no action".

## Step 3 — Recommend per component

For each, decide the **target** on the LTS-not-bleeding-edge rule:

- Two majors behind, newest stable available, next major still beta → target the newest **stable** major (e.g. Vite 7 when 8 is beta).
- Current major has a newer GA major that's been out a while and is actively maintained → take the GA major; avoid a maintenance-only older line (e.g. Vitest 4 over backport-only v3).
- Runtime past/near EOL → urgent; target the LTS with the longest runway.
- Already on the current major → routine patch/minor bump, low risk, batch with siblings.

## Step 4 — Constraints & ordering

For each non-trivial upgrade, capture what gates or couples it. Recurring ones in this repo:

1. **Runtime-before-tooling** — Vite N requires a Node floor; bump Node first.
2. **Lockfile on target Node** — regenerate `package-lock.json` on the Node version CI will use (CLAUDE.md guardrail; mismatched npm/Node → `npm ci` fails).
3. **Coupled majors move together** — Vite + Vitest in one PR; all `@tiptap/*` in lockstep (incl. any exact-pinned one).
4. **Peer-range caps** — e.g. typescript-eslint caps TypeScript `<6.1.0`; check peers before bumping a framework.
5. **Isolate big/risky moves** — one major per PR so a regression points at one change.
6. **Deploy-path changes** (CDK, CI) — run `cdk synth`/`cdk diff`, check `Infrastructure.Assertions`, state the deploy-time delta (CLAUDE.md deploy-time guardrail).
7. **Test-framework majors are structural** (e.g. xUnit v2→v3: projects become executables, runner + skip-API changes) — schedule last, lowest urgency while the old line still gets security patches.

Assign each item an **urgency**: High (EOL / security on a pinned package) · Medium (two+ majors behind, or a framework move) · Low (routine patch, current major).

## Step 5 — Write the report

Create `docs/dependency-audits/dependency-upgrade-audit-<YYYY>-<MM>.md` (the `docs/dependency-audits/` folder holds every dated audit; use the date from session context — do not guess). Follow the `## Writing style` rule: tables and numbered lists, one fact per point, lead with the conclusion. Sections:

1. **Goal** line + the LTS-not-bleeding-edge rule.
2. **Ordered task backlog** table: `# | Task | Type | Risk | Depends on | Urgency`.
3. **Current vs target** tables, grouped (runtime/framework, frontend toolchain, frontend libs, backend, test, Actions): `component | current | latest stable | target | note`.
4. **Constraints & ordering** — numbered.
5. **No action needed** — already-LTS/current list.
6. **Ordered task detail** — one numbered entry per task with a one-line rationale.
7. **Sources** — markdown links to the release/registry pages used.

## Step 6 — Graduate High + Medium items into the tracker

Add **only the High + Medium-urgency** items to `docs/technical-improvements.md` (Low items stay in the audit doc until picked up). For each:

- Add a row to the `## Summary` table (`| <Item> (dep-audit T#) | 🔲 **Open** — <hook> |`), preserving the audit's dependency ordering.
- Add a detailed section at the end: **Urgency**, **What**, **Why**, **Constraint(s)**, **Raised in:** (`Dependency upgrade audit, <date>`), **Depends on:**.
- Update the **Outstanding (N Open + M Partly)** count line and its item list.
- Add a one-line pointer to the audit doc near the top of the Summary so the low-urgency items remain discoverable.

Cross-reference an existing tracker item if the new one graduates a previously-deferred decision (e.g. the build-Node bump graduates the deferred half of an Actions-Node item).

## Done when

- `docs/dependency-audits/dependency-upgrade-audit-<date>.md` exists with all six report sections.
- High + Medium items appear in `docs/technical-improvements.md` (Summary rows + detail + updated Outstanding count + audit-doc pointer).
- Every recommendation is justified on the LTS-not-bleeding-edge rule, with constraints and ordering stated.

This skill **reports and tracks** — it does not perform the upgrades. Each graduated item is actioned later through the normal pipeline (its own PR, per the ordering).
