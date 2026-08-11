---
name: observability-review
description: Operate-side skill. Periodically review the DEPLOYED observability — the notetaker-ops CloudWatch dashboard, Lambda log groups, RUM, alarms, X-Ray — find real errors and visibility gaps, verify each against current code, and file them as bugs (phase-bugs.md) or technical improvements (technical-improvements.md). Does NOT instrument code (that is `observability`) and is NOT pre-implementation planning (that is `observability-brief`). Triggers include "review the dashboard", "any errors in prod", "check observability for bugs", "what's erroring in production", "observability review", or on a schedule.
---

# Observability Review

The **operate** counterpart to the two build-time observability skills:

| Skill | Phase | Job |
|-------|-------|-----|
| `observability-brief` | Scout / pre-impl | flag silent failure modes, write the phase-doc Observability section |
| `observability` | Pip / build | add logs, traces, metrics, dashboards, alarms |
| **`observability-review`** *(this)* | **operate** | **inspect the live signals, triage real findings, file bugs/improvements** |

Goal: turn what the deployed app is *actually* doing into a short, verified list of work — not a log dump. The deliverable is rows in `docs/phases/phase-bugs.md` and/or `docs/technical-improvements.md`, each with prod evidence, a root cause (or a clear "unknown"), severity, and a fix direction.

Run it on a **cadence** (see *Cadence* below), or on demand.

---

## Access (read this first)

- **Prod is a non-default account:** `--profile prod` (acct 642653037268, region eu-west-2). The default CLI account is NOT the live app. See memory `reference_prod_aws_account`.
- **Run `aws` and `gh` with `dangerouslyDisableSandbox`** — the sandbox proxy strips auth headers (memory `reference_gh_sandbox_401`).
- **The "where to look" index is [`docs/observability.md`](../../docs/observability.md)** — it maps each question to its dashboard widget / saved query / log group. Read it before sweeping; it changes.
- Fetch the live resource names from stack outputs, do not hard-code:
  `aws cloudformation describe-stacks --stack-name NoteTakerStack --region eu-west-2 --profile prod --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output text`

---

## Step 1 — Sweep the signals

Pick a window (default **14 days**; widen for a first run). Sweep every source — a finding invisible in one often shows in another.

| Source | How |
|--------|-----|
| **Backend errors** | Logs Insights over the API Lambda log group(s) **and** the projector log group: `filter level in ["Error","Warning"] or @message like /(?i)exception\|error\|fail\|timeout\|throttl/ \| sort @timestamp desc`. List both API log groups — there can be an auto-named `/aws/lambda/…ApiFunction…` **and** an explicit `…ApiFunctionLogGroup…`; check which is current. |
| **Backend exceptions (full)** | For each distinct unhandled-500, pull the full Powertools line — the `exception.type` / `stack_trace` fields carry the real cause (the `"An unhandled exception has occurred"` line, logger `Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddleware`, holds the exception object). |
| **Frontend errors** | RUM (`notetaker-rum`): Errors tab + `JsErrorCount`/`HttpErrorCount`. Resource-load 403s (`<img>` etc.) ride `JsErrorCount` / `js_error_event` since TI-37. The dashboard "All errors (backend + frontend)" widget queries the RUM log group too. |
| **Alarms** | `aws cloudwatch describe-alarms --profile prod` — any in `ALARM`, and any that *should* exist but don't. |
| **Latency / faults** | X-Ray service map for fault/throttle hot spots; the dashboard p50/p99 + DynamoDB `SystemErrors`/`ThrottledRequests` widgets. |
| **Deploy health** | Recurring deploy-gate failures (e.g. flaky E2E) are an observability/CI finding too — route to `technical-improvements.md`. |

Summarise by *shape*, not line-by-line: group by `exception.type`, message template (strip ids/numbers), and endpoint. Counts matter more than individual lines.

---

## Step 2 — Triage each finding (the discipline that makes this useful)

For every candidate, before writing anything:

1. **Verify against CURRENT code — a deployed log can predate a fix.** Read the handler/mapper the stack trace names. *Example (this is real):* a `RenameNote → InvalidOperationException → 500` log was already fixed by a later `mustExist`/`NoteNotFoundException` guard — do **not** file an already-fixed bug. State "verified fixed in `<file:line>`" and drop it.
2. **Separate expected outcomes from faults.** A `ConcurrencyException` mapped to 409, or a missing-note write mapped to 404, is a *business outcome* logged at **Warning**, not a bug. Only unmapped/unhandled 500s, real exceptions, throttles, and stalls are faults. (Post-TI-38, the level is truthful: Warning = expected, Error = fault.)
3. **Classify the finding type** — this decides where it goes:
   - **Reliability/behaviour bug** (something is broken, crashes, or returns the wrong status) → `docs/phases/phase-bugs.md`.
   - **Observability gap** (a real failure the monitoring *cannot see* — under-reporting) → `docs/technical-improvements.md`. *Distinct from a bug:* the classic is a client-side failure that reaches neither RUM nor the backend (e.g. resource-load 403s were invisible because RUM `http` telemetry is fetch/XHR-only and the asset is S3→CloudFront direct — TI-37).
   - **Dashboard/log accuracy** (over-reporting, mislevelled, noisy — real errors drowned) → `technical-improvements.md` (e.g. TI-38: the framework double-logging expected conflicts at Error).
   - **Minor tweak** → `phase-minor-changes.md`; **model/prompt** → `phase-model-prompt-improvements.md`. Route by the CLAUDE.md "one place per type" rule.
4. **Establish root cause or say "unknown".** Use the correlation id / `xray_trace_id` to pull the full request trail (see the runbook). If you can't determine it, write the evidence and mark cause unknown — do not guess in the doc.

---

## Step 3 — Write it up (evidence-backed, terse)

Add a summary-table row **and** a detail section to the routed doc, following that doc's existing format (`## Summary` table row + a `## BUG-N` / `## TI-N` detail block).

**The row is one or two lines, in plain language, saying what the person using the app experiences** — no file names, no log groups, no exception types, no status codes. Everything you gathered goes in the detail block, not the cell; a row that carries its own evidence makes the `Summary` column unreadable, which is the only job that column has. Allocate the id with `scripts/next-doc-id.sh <bug|ti>` — never hand-picked.

Each detail block carries:

- **Status / Severity** (one line each).
- **Symptom** — what the user/operator sees (status code, the exact request path, `X-Cache`, etc.).
- **Prod evidence** — log timestamp(s), `exception.type`, counts over the window, a trace id. Concrete, quotable.
- **Root cause** — the file/mechanism, or "unknown — evidence above".
- **Observable?** — for a bug, state whether it is already visible (metric/log) or invisible. An *invisible* failure is itself the more important finding.
- **Fix direction** — one or two options, not a full design.
- **Reproduce-before-fix** note where applicable.

Commit the captured docs to `main` directly (backlog capture is the normal `docs:` pattern — stage only the doc files; verify the staged set first per memory `feedback_main_staged_index`). This is not slice code, so it does not need a PR.

**Honesty rules:**
- A finding you verified as already-fixed is reported as such (and not filed). Saying "I checked, it's fixed" is a valid, valuable outcome.
- A clean sweep ("no new faults this window; expected 409/404 warnings only") is a legitimate result — write it, don't manufacture findings.
- Never paste user data (note content, emails, tag values) into a doc — IDs, types, counts, versions only.

---

## Step 4 — Hand off to implementation (optional)

If the user wants the findings fixed, hand the filed items to `run-pipeline` (each becomes a slice). Respect the same-file rule when parallelising (two findings touching `LoggingConfig.cs` must sequence, not run concurrently). Carry forward the cross-cutting lessons:
- **A "no request fires / no fetch" property is unprovable in jsdom** — PR CI (no E2E) will green a broken frontend fix; the deploy-gate E2E is the only proof. See memory `feedback_no_fetch_unprovable_in_jsdom`. Don't declare such a fix done on a unit seam.
- Match resilience cost to scale and flag deploy-time deltas (CLAUDE.md guardrails).

---

## Cadence

This is meant to run **regularly**. Options:
- **On demand** — invoke when asked ("review the dashboard", "anything erroring in prod").
- **Scheduled** — a cloud routine (e.g. weekly) that runs the sweep, files any new findings, and reports the diff since last run. Set up with `/schedule` (a cron routine) or `/loop` for a session-bound cadence. A scheduled run should: sweep → triage → file new items → post a one-line summary ("N new findings filed, M verified-already-fixed, sweep clean otherwise").

Keep each run cheap: summarise by shape, file only verified findings, and lean on the runbook + saved queries rather than re-deriving where to look.
