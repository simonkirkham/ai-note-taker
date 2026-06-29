---
name: observability-brief
description: Scout skill. After GWT scenarios are drafted for a phase, analyse each slice for silent failure modes and produce an Observability section in the phase doc. Covers what behaviour must be visible in production and flags instrumentation gaps in code the slice touches. Does not produce implementation code. Triggers include "what could go wrong", "how would we know if this is broken", "observability section", or automatically when Scout finalises a phase doc.
---

# Observability Brief

This skill runs after Scout has drafted the GWT scenarios for a phase, before the human hand-off. It produces an **Observability** section inside each slice in `docs/phases/phase-N.md`.

The goal is not to specify which classes need logging. It is to answer: **if this slice breaks silently in production, how would anyone know?**

---

## When to invoke

Run once per phase, after all slice GWT scenarios are written. Work through each slice in order. Add the `## Observability` section directly below the `Scenarios:` block for that slice.

---

## Step 1 — Ask the verification question

For each slice, start by writing the answer to this question into the phase doc:

> How would an on-call engineer confirm this feature is working at 2am, without looking at the code or talking to a user?

If the answer is "they couldn't" — that is the most important finding. Write it explicitly. The gap audit in Step 3 will surface what needs to be added.

---

## Step 2 — Identify silent failure modes

Work through each scenario in the slice using the failure-mode checklist below. A **silent failure** is one where the user gets a wrong result or no result, but nothing obvious breaks — no exception, no 500, no alert.

For each failure mode that applies to the slice, record:
- What the failure is
- Why it would be silent (the system would not visibly complain)
- What signal would surface it (a specific log field, a metric spike, a trace anomaly)

**Failure-mode checklist:**

### Domain / event-store failures

- [ ] **Command accepted, projection never updated.** The event appended successfully, but the `IDomainEventHandler` for this slice's projection threw and was swallowed. The user sees their action disappear on refresh. *Signal: log on each handler dispatch with the handler type and whether it succeeded; projection item count metric.*
- [ ] **Concurrency conflict accepted silently.** The caller retries after a 409 and succeeds — the user never knew. But if conflicts are elevated it signals contention. *Signal: `ConcurrencyConflict` metric with aggregate and stream ID.*
- [ ] **Wrong stream written.** The aggregate ID was derived incorrectly (e.g. wrong user ID, wrong note ID). The write succeeds but data lands in the wrong stream. *Signal: log the stream ID on every append alongside the command type and user ID so you can cross-reference.*
- [ ] **Replay / rebuild stalled.** If this slice adds a new event type that a projection must handle, a projection rebuild could silently skip unrecognised events. *Signal: log every skipped event type during rebuild; metric for total events processed vs total events in stream.*

### Lambda / infrastructure failures

- [ ] **Lambda timeout mid-request.** The function has a 29s limit. A slow DynamoDB response causes a 504 at the API Gateway level, but the Lambda log may not capture the final state. *Signal: CloudWatch Lambda `Timeout` metric; structured log at the start of every command handler with the estimated operation cost.*
- [ ] **Cold start on a latency-sensitive path.** SnapStart is on, but new versions have init time. *Signal: Powertools logging marks cold starts automatically; X-Ray shows init duration separately.*
- [ ] **Lambda throttle.** At burst, Lambda may throttle invocations rather than error. The caller sees 429 or a timeout. *Signal: CloudWatch `Throttles` metric for the function; alarm if non-zero.*

### DynamoDB failures

- [ ] **Stale read immediately after write.** A projection read immediately after an event is appended returns the pre-write value (eventual consistency). *Signal: `ConsistentRead = true` is mandatory on all base-table reads — verify this is the case for any projection this slice introduces or extends. Log a warning if a read returns a version lower than expected.*
- [ ] **Conditional write failure not categorised.** A `ConditionalCheckFailedException` is a known concurrency conflict, not an infrastructure error. If it gets caught by a generic error handler it masquerades as a 500. *Signal: catch `ConditionalCheckFailedException` explicitly and emit `ConcurrencyConflict` metric, not `CommandFailed`.*
- [ ] **DynamoDB throttle / capacity error.** Pay-per-request tables can still throttle on hot partitions. *Signal: DynamoDB `SystemErrors` and `ThrottledRequests` metrics on the table; CloudWatch alarm.*

### Frontend / optimistic-update failures

- [ ] **Optimistic update applied, API call fails, UI not reconciled.** The user sees state that doesn't match the server. *Signal: structured console error (RUM captures it) with the command type and the server error; a metric if the reconcile path is hit.*
- [ ] **Auth token expired mid-session.** The API returns 401. If the frontend doesn't handle this case explicitly, the user gets a blank panel with no error. *Signal: RUM captures uncaught errors; 401 response should always navigate to the sign-in page and log a `SessionExpired` event.*
- [ ] **CloudFront served a stale cached response.** The deploy invalidated the API path, but the old frontend JS is cached at the edge. *Signal: include the deploy commit SHA as a response header on health-check; compare with `document` meta tag injected at build time.*

### Auth / security failures (for slices involving `ICurrentUser`)

- [ ] **Wrong user ID written to events.** The `sub` claim was extracted incorrectly or defaulted to an empty string. Events are permanently attributed to the wrong user. *Signal: log `UserId` (hashed or last 4 chars only — not the full sub) on every command handler invocation. Alert if `UserId` is blank or a known-bad sentinel.*
- [ ] **Allowlist bypass.** A user whose `sub` is not in `ALLOWED_USER_SUBS` somehow reaches the domain. *Signal: log the `sub` claim length and prefix (not the value) on every auth decision; metric for `AuthDenied` vs `AuthAllowed`.*

---

## Step 3 — Gap audit: instrumentation in code this slice touches

Read the files this slice will modify. For each file listed below that the slice touches, check the current state against the expected instrumentation.

**Files to check and what to look for:**

| File pattern | What should already be there |
|---|---|
| `src/Api/CommandHandlers/*CommandHandler.cs` | `ILogger<T>` calls with `{StreamId}`, `{Version}`, `{CommandType}` on every append path; `ConcurrencyConflict` metric on `ConditionalCheckFailedException` |
| `src/Api/EventHandlers/*EventHandler.cs` | Log entry when handler is dispatched; log entry (Warning) when handler throws; projection name in structured fields |
| `src/EventStore/Projections/Dynamo*Store.cs` | `ConsistentRead = true` on all base-table reads; structured log on every write with the PK being updated |
| `src/Infrastructure/NoteTakerStack.cs` | Lambda `Tracing = ACTIVE`; dashboard widget for any new DynamoDB table |
| `web/src/` (any component) | RUM active; API error paths log to console with command type and status code |

For each gap found, add a checkbox to the phase doc section so Pip knows it must be closed before the PR merges. Use this format:

```
**Instrumentation gaps (must close before PR merges):**
- [ ] `NoteCommandHandler.cs` — no `{StreamId}` or `{Version}` in log calls
- [ ] `NoteDetailEventHandler.cs` — no log on dispatch or on throw
```

If no gaps exist for a given file (it's already well-instrumented), say so explicitly. A blank audit is as useful as a list of gaps — it tells Pip there is nothing extra to add.

---

## Step 4 — Write the phase doc section

Add an `## Observability` section to each slice in the phase doc. Use this template:

```markdown
## Observability

**Verification question:** [One sentence: how would an on-call engineer confirm this slice is working at 2am?]

**Silent failure modes:**

| Failure | Why it would be silent | Signal |
|---------|----------------------|--------|
| [failure description] | [why no obvious error] | [log field / metric name / trace subsegment] |

**Instrumentation gaps (must close before PR merges):**
- [ ] [file] — [what is missing]
```

If a slice has no silent failure modes (genuinely rare — usually a CDK-only or doc-only slice), write:

```markdown
## Observability

No silent failure modes identified. This slice makes no changes to Lambda handlers, projections, or frontend call paths.
```

Never omit the section entirely. An explicit "nothing to flag" is more trustworthy than a missing section.

---

## Scope rules

- Do not specify which lines of code to change, which NuGet packages to add, or how to wire the metric emitter. That is the `observability` skill's job (used by Pip).
- Do not invent failure modes that are impossible given the slice scope. Keep the table honest — two real rows beat five speculative ones.
- Do not audit files outside the slice scope. If `FolderCommandHandler.cs` has gaps but this slice doesn't touch it, don't list it — add it to `docs/technical-improvements.md` instead.
- User data must not appear in any suggested log field. Log IDs, types, counts, and versions. Never log note content, user emails, or tag values.
