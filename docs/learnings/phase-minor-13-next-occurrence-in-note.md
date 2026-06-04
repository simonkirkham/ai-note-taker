# CHANGE-13 — "Next occurrence" control inside a recurring-meeting note

**Shipped:** 2026-06-04 · PR #162 (squash `23e3940`) · deploy run 455 (success)
**Type:** Minor change (standing track). Reuse-in-a-new-location; read-side + frontend only.

## What shipped

Slice 9-F put a "next occurrence" affordance on the home screen's *Today's Meetings* panel only. Once inside a note, the affordance was gone. This change surfaces the same capability inside `NoteView`: when the open note belongs to a recurring series, a `Next occurrence →` control creates-or-opens the next occurrence's note and navigates straight there — reusing the existing `POST /notes/from-next-occurrence` endpoint and the `onOpenNote` callback.

No new event, no event-shape change, no projection rebuild.

## Design decision: how a note learns its own series link (option 1 won)

The note read path (`GET /notes/{noteId}` → `NoteDetail`) carried no link back to its calendar series. Two ways to source it were on the table:

1. **Reverse lookup on the existing `CalendarLinkView` projection** — add `GetByNoteIdAsync` and populate `recurringSeriesId`/`isRecurring` on the read path. *(chosen)*
2. Retain `RecurringSeriesId` on the `Note` aggregate's apply of `NoteLinkedToCalendarEvent` and thread it onto `NoteDetail`.

Option 1 was chosen because the projection **already holds the mapping** (it is deletable by note id), so the data exists and is rebuildable with zero aggregate/event change. The decisive correctness property: `recurringSeriesId` comes from the **server read path**, so the control works on a cold page reload / direct note open with no in-memory meeting context — which is exactly the gap 9-F's own learning called out.

## Learnings

### 1. DynamoDB `Limit` is applied *before* `FilterExpression` — never `Limit = 1` a filtered scan

The first cut of `GetByNoteIdAsync` used `Scan` with `FilterExpression "NoteId = :noteId"` and `Limit = 1`, intending "return the first match cheaply." That is a latent bug: DynamoDB applies `Limit` to the items **read**, then applies the filter to that page. `Limit = 1` reads one item, filters it, and returns nothing if that one item didn't match — even when a match exists later in the table. The fix paginates with `ExclusiveStartKey` until a match is found or the table is exhausted, identical to the existing `DeleteByNoteIdAsync`. **Rule: a filtered `Scan`/`Query` must paginate; `Limit` is a page-size knob, not a result cap.**

### 2. `isRecurring` is *derived*, not stored

`isRecurring` is computed as `calendarLink?.RecurringSeriesId is not null`, not read from a stored boolean. A note linked to a one-off meeting has no `RecurringSeriesId` persisted (the upsert only writes that attribute when non-null), so it correctly reports `isRecurring = false`. Deriving the flag from the single source of truth (presence of the series id) means there is no second field that can drift out of sync. Covered by the `GetNote_NonRecurringLinkedNote_HasNoSeriesLink` test.

### 3. "Optimistic-first" does not apply to a *navigation* action

The optimistic-UI convention exists for state mutations: apply the expected local state immediately, reconcile on error. This handler **navigates** to a server-generated note id — there is no local state to flip optimistically, and nothing to "revert" because the navigation itself is the only effect. The applicable part of the `MeetingsSection` pattern is the `disabled`-while-in-flight re-entrancy guard; on error we simply don't navigate (inline message for `404 no_future_occurrences`, toast otherwise). Worth stating explicitly because the slice's acceptance criterion named "revert-on-error" by analogy — Hawk confirmed N/A for navigation.

### 4. The Node-version lockfile trap recurred (known guardrail, caught in review)

The worktree's `npm install` ran under local Node 24 / npm 11 and regenerated `web/package-lock.json`, stripping the optional native-binding entries (`@emnapi/*`) that CI's Node 20 `npm ci` expects and adding `peer` markers. The slice adds **no** dependencies, so the correct action was to `git checkout -- web/package-lock.json` and never stage it. Caught during the self-refactor diff review (the `--stat` showed an unexpected 59-line lockfile churn). The existing guardrail held; the lesson is to scan `git diff --stat` for unexpected lockfile churn before committing any slice that touched `web/`.

## Follow-up (non-blocking, noted by Hawk)

`GET /notes/{noteId}` now runs a calendar-link `Scan` on **every** note load, including plain notes that will never match (the scan walks the whole table to find nothing). Fine at current scale. If the calendar-link table grows, this is a candidate to fold into the **scalable note loading** future-feature (a `NoteId`-keyed GSI, or carrying the series link on the `NoteDetailView` projection itself). Logged here rather than actioned now — premature for a learning-vehicle app at current data volume.

## Done actions applied

- Marked CHANGE-13 **Done** in `docs/phases/phase-minor-changes.md` (summary table + per-item status + all 9 acceptance criteria ticked).
- Updated the Minor Changes summary in `docs/roadmap.md`.
- No guardrail/permission/config change needed — the two reusable lessons (filtered-scan pagination; lockfile churn) are captured above; the lockfile trap is already an explicit CLAUDE.md guardrail.
