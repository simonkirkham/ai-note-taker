# Phase 32-A — Microsoft 365 (Outlook) calendar provider

**Shipped:** PR #320, deploy #620 (2026-06-23). Shipped **dark** — `CALENDAR_PROVIDER` defaulted to
`google`; activated by setting it to `microsoft` and minting an SSM token. _(Superseded by Phase 34:
calendars are in-app per workspace; `CALENDAR_PROVIDER` + the SSM token/guide were removed in 34-D2.)_

**What:** a provider-agnostic `ICalendarClient` (renamed from `IGoogleCalendarClient`) with a
Microsoft-Graph-backed implementation selected by a `CALENDAR_PROVIDER` env switch, mirroring the
Phase 9 Google model (out-of-band refresh token in SSM, `invalid_grant` self-heal, conditional
SSM grant). Recovered from a WSL crash mid-slice: Breaker's specs were committed; Pip's
implementation was on disk uncommitted and ~complete.

## Non-obvious lessons (the why worth keeping)

### 1. Two distinct test-parallelization races bit one slice — and they need different fixes
Adding the slice tripped **two separate** xUnit-parallelism failures, each from a different shared
resource:

| Race | Shared resource | Symptom | Fix |
|---|---|---|---|
| A new **2nd `Infrastructure.Assertions` class** building a CDK `Template` in a static ctor | JSII asset bundle extracted to a shared `/tmp` file (`aws-cdk-asset-awscli-v1-*.tgz`) | `IOException: being used by another process` | `[assembly: CollectionBehavior(DisableTestParallelization = true)]` for that assembly |
| Three **`Api.Integration` calendar classes** mutating `CALENDAR_PROVIDER`/`STUB_CALENDAR_JSON`/`MS_*` | process-wide env vars | a sibling sets `STUB_CALENDAR_JSON` while another constructs a client → wrong events; deterministic when run together | `[CollectionDefinition("CalendarEnv", DisableParallelization = true)]` + `[Collection]` on all three |

**The trap:** the fix for one does *not* fix the other. An assembly-wide
`DisableTestParallelization` in `Infrastructure.Assertions` does nothing for the `Api.Integration`
assembly — each assembly parallelizes independently. The env-var race needs a `[Collection]` in
*its own* assembly (the existing `AuthEnvCollection` was the pattern to copy). Hawk caught this:
the first attempt mis-targeted the assembly. **Lesson:** parallelization isolation is per-assembly;
when adding a class that mutates a process-global (env var) or a shared on-disk resource (JSII
extraction), serialize it *in the assembly where it lives*, and check whether an existing
`[Collection]` already exists to join.

### 2. `cdk synth` needs BOTH the Api **and** the Projector published
The CLAUDE.md "How to run" only mentions `dotnet publish src/Api` before `cdk synth`, but the stack
also references the Projector Lambda asset (`src/Projector/bin/Release/net10.0/publish`). Synth
fails with `Cannot find asset at .../src/Projector/...publish` until the Projector is published too.
Publish both before synthing locally.

### 3. Mint-tool and runtime tenant defaults MUST agree (silent `invalid_grant`)
The device-code mint script defaults `MS_TENANT_ID` to `consumers` (personal MSA). The runtime
client originally defaulted to `common`. A token minted against one tenant alias but refreshed
against another yields `invalid_grant` at refresh time — exactly the silent-degradation path the
slice tries to surface. Aligned both to `consumers`. **Lesson:** when a credential is minted by one
tool and consumed by another, any auth-affecting default (tenant, scope, audience) must be
identical on both sides, or documented as required-explicit.

## Patterns that worked
- **`IMicrosoftRefreshTokenSource` seam** — splitting the SSM read behind an interface made the
  two-attempt `invalid_grant` heal loop unit-testable with a fake (`ForceReloadCount`) without
  touching AWS. Reuse this shape when a self-heal path depends on an external store.
- **Raw-HTTP Graph client (no MSAL/Graph SDK in the Lambda)** — keeps the function lean; the
  refresh-token exchange and `/me/calendarView` are a handful of `HttpClient` calls. MSAL stays in
  the dev-only mint tool.
- **Ship dark behind an env switch** — the default-`google` provider switch means the slice merges
  and deploys with zero prod behaviour change; activation is an env flip + a token mint, decoupled
  from the deploy.

## Follow-up
- **TI-47** — replace the out-of-band SSM minting tool (both Google and Microsoft) with proper
  in-app OAuth + a per-user server-side refresh-token store. The CLI mint is the deliberate
  single-user shortcut; the real multi-user pattern is auth-code + PKCE → token persisted per `sub`.
- **32-B** — recurring next-occurrence for Outlook (`GetNextOccurrenceAsync`, currently returns
  `null`/logged).
