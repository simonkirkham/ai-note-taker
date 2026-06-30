# Phase 44 — Change or remove a note's linked meeting _(In Progress — 44-A done 2026-06-30)_

**Goal:** move a note to a different meeting, or detach it from its meeting entirely, when the meeting gets rescheduled, replaced, or the notes turn out to fit a different meeting.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 44-A  | Change a note's meeting — re-pick any meeting and the note moves to it | Done | — |
| 44-B  | Unlink a note from its meeting — it goes back to a standalone note | Not Started | 44-A |

44-A is the thin vertical that proves the whole flow (a linked note can be re-pointed at a different meeting, old meeting freed, new one claimed). 44-B exposes "no meeting" as a destination, reusing the same link-removal plumbing 44-A introduces.

**Reframing carried from scouting:** a *rescheduled* meeting usually keeps the **same** calendar event ID — only its time changes — so "the meeting moved" is often a stale **cached time**, not a wrong link. Auto-refreshing the cached time on reschedule is the better fix for that case but is **out of scope here** (see *Later*). This phase covers the two cases that genuinely need a user to act: the notes now belong to a *different* meeting, and detaching entirely.

## Slices

<!-- REVIEW SURFACE — read this and stop. No technical artefact named below the slice headings. -->

### Slice 44-A — Change a note's meeting _(Done — #367, deployed #672 2026-06-30)_

- **User value:** you prepped a note for one meeting, the plan changed, and now those notes belong to a different meeting — re-point the note in two clicks instead of copy-pasting into a new note.
- **How it works:**
  - On a note already linked to a meeting, the linked-meeting badge gains a **"Change"** action.
  - Clicking it opens the same meeting picker used for the first link, defaulting to the currently-linked meeting's date.
  - Picking a different meeting swaps the badge to the new meeting **immediately** (optimistic); reconciles on error.
  - On the home view the **old** meeting returns to "Create Note" and the **new** meeting now shows "Open Note".
  - A meeting that already has its own note stays non-selectable (same rule as first-link), so you can't double-book.
- **Scenarios (GWT):**

```
Scenario: Move a note to a different meeting
  Given a note linked to meeting "Standup"
  When  the owner changes its meeting to "Budget review"
  Then  the note's linked-meeting badge shows "Budget review"
  And   on reload the note is still linked to "Budget review"

Scenario: The old meeting is freed
  Given a note linked to meeting "Standup"
  When  the owner changes its meeting to "Budget review"
  Then  "Standup" again offers "Create Note"
  And   "Budget review" now offers "Open Note" for this note

Scenario: Optimistic swap
  Given a note linked to meeting "Standup"
  When  the owner picks "Budget review"
  Then  the badge shows "Budget review" before the server responds
  And   if the change fails the badge reverts to "Standup" with an error

Scenario: Cannot steal a meeting that already has a note
  Given meeting "Budget review" already has its own note
  When  the owner opens the picker to change a different note's meeting
  Then  "Budget review" is shown as already taken and is not selectable

Scenario: Re-point within the same recurring series
  Given a note linked to one occurrence of the weekly "1:1" series
  When  the owner changes it to a different occurrence of the same "1:1" series
  Then  the note is linked to the new occurrence
  And   the "next occurrence" affordance still recognises it as that series
```

### Slice 44-B — Unlink a note from its meeting

- **User value:** these notes turned out not to be meeting notes after all (or the meeting was cancelled) — detach the note and keep it as a plain standalone note, without deleting anything.
- **How it works:**
  - The linked-meeting badge gains a **"Remove"/"Unlink"** action.
  - Clicking it detaches the note **immediately** (optimistic); the badge becomes the "Link to meeting" button again.
  - The note's title, body, tags and to-dos are untouched — only the meeting link is removed.
  - On the home view the meeting returns to "Create Note".
- **Scenarios (GWT):**

```
Scenario: Unlink a note
  Given a note linked to meeting "Standup"
  When  the owner removes the meeting link
  Then  the note shows "Link to meeting" (no linked meeting)
  And   on reload the note is still unlinked

Scenario: The meeting is freed
  Given a note linked to meeting "Standup"
  When  the owner removes the meeting link
  Then  "Standup" again offers "Create Note"

Scenario: Content is preserved
  Given a linked note with a title, body, tags and to-dos
  When  the owner removes the meeting link
  Then  the title, body, tags and to-dos are unchanged

Scenario: Optimistic unlink
  Given a note linked to meeting "Standup"
  When  the owner removes the link
  Then  the badge clears before the server responds
  And   if it fails the linked-meeting badge returns with an error
```

---

## Build notes _(implementation — skip when reviewing)_

<!-- Everything agent-facing below: events, projections, API, tests, decisions. -->

### Shared model (lock in 44-A's spec via `event-modelling`)

- Current link is on the **Note** stream: `Note._calendarEventId`, set by `LinkNoteToCalendarEvent` → `NoteLinkedToCalendarEvent`. `Note.HandleLinkToCalendarEvent` **throws `InvalidOperationException` when already linked** — this guard must be lifted/relaxed.
- **Recommended (lean, composable):** add **one** new event `NoteUnlinkedFromCalendarEvent` (payload: `previousCalendarEventId`). Model:
  - **Unlink (44-B):** new command `UnlinkNoteFromCalendarEvent` → emits `NoteUnlinkedFromCalendarEvent`; aggregate clears `_calendarEventId`. No-op/idempotent if already unlinked.
  - **Re-link (44-A):** new command `RelinkNoteToCalendarEvent` (or reuse `LinkNoteToCalendarEvent` with the guard relaxed) → command handler emits `NoteUnlinkedFromCalendarEvent` (old id) **then** `NoteLinkedToCalendarEvent` (new event details), in one append. Aggregate allows `Link` when `_calendarEventId` is null after the unlink.
  - Net new event types: **1** (`NoteUnlinkedFromCalendarEvent`); re-link reuses the existing link event.
- **Alternative considered:** a single `NoteCalendarLinkChanged` (old + new in one event) for an atomic projection swap. Cleaner for the projection but adds a second new event type and a bespoke change-path; rejected in favour of the composable unlink+link unless the spec surfaces an atomicity need.
- **No event versioning** — both paths are purely additive; do **not** touch shipped event shapes or the `EventDeserializer` arms for `NoteLinkedToCalendarEvent`.
- **Projection:** `CalendarLinkIndexProjection` / `CalendarLinkView` / `ICalendarLinkIndexStore` already exist. Add an `NoteUnlinkedFromCalendarEvent` arm that **deletes** the link row — clearing **both** keys: by `noteId` (`GetByNoteIdAsync`) and the reverse `calendarEventId` key (`GetByCalendarEventIdAsync`), so the freed meeting returns to "Create Note". Re-link = delete-old-row + upsert-new-row via the two existing event arms. Wire the new arm into `ProjectionRebuildHandler`.
- **No backfill / no new table** — `CalendarLinkView` already exists and is populated; this slice only adds a delete path. (The new-projection-ships-empty guardrail does **not** apply.)
- **Read composition:** `GET /notes/{id}` composes the linked meeting at read time via `calendarLinkStore.GetByNoteIdAsync`. After unlink/re-link this must return the new state (or null). Confirm whether `CalendarLinkView` is read off an **async** projection — if so, the optimistic UI carries the user across projector lag (RYW); add a reload-tolerant E2E wait, do not assert a bare immediate read.

### 44-A — Change a note's meeting
- **Commands/events:** `RelinkNoteToCalendarEvent` (or relaxed `LinkNoteToCalendarEvent`); emits `NoteUnlinkedFromCalendarEvent` + `NoteLinkedToCalendarEvent` in one append. Relax/remove the already-linked throw in `Note.HandleLinkToCalendarEvent`.
- **Recurring:** carry `IsRecurring` + `RecurringSeriesId` from the picked meeting into the new link (same as first-link), so `RecurringSeriesId` updates correctly when moving across series, and "next occurrence" computes against the new series.
- **API:** prefer a single endpoint that handles re-link, e.g. `PUT /notes/{noteId}/calendar-link` (idempotent set) instead of overloading the 409-returning `POST /notes/{noteId}/calendar-link`. Decide in the spec; if reusing POST, stop it 409-ing when the note is already linked.
- **Projection:** delete old `CalendarLinkView` row (clears reverse key) + upsert new row; both via existing event arms.
- **Web:** `NoteView.tsx` linked-meeting badge gains a "Change" action opening `MeetingPicker.tsx` defaulted to the linked meeting's date; `useLinkNoteToCalendar` (or a new `useRelinkNoteToCalendar`) does an optimistic `linkedMeeting` swap + reconcile-on-error. `MeetingsSection.tsx` already derives "Create Note"/"Open Note" from `linkedNoteId`, so the home view follows from the projection — no change beyond it reflecting the new link.
- **Tests:**
  - Domain spec: linked note → re-link → asserts unlink+link events, `_calendarEventId` updated.
  - `EventStore.Integration`: `CalendarLinkView` round-trip — set link A → re-link to B → assert `GetByNoteIdAsync` = B and `GetByCalendarEventIdAsync(A)` = null.
  - `Api.Integration`: re-link endpoint returns 200 and `GET /notes/{id}` shows the new meeting; picking a meeting already owned by another note stays rejected.
  - `Browser.E2E`: link → change → reload, reload-tolerant assert on the new badge (async projector).
- **Acceptance criteria:**
  - [x] BDD spec first; chose **unlink+link** (one new event `NoteUnlinkedFromCalendarEvent`, reuse the link event) over a single change event — recorded in `LinkNoteToCalendarEventSpec`.
  - [x] Already-linked guard relaxed; re-link emits unlink+link in one append; **no-op when re-linking to the same meeting**.
  - [x] `NoteUnlinkedFromCalendarEvent` deletes the freed row (frees the old meeting); handled in the live `ProjectionUpdater` **and** the rebuild `CalendarLinkIndexProjection`.
  - [x] `RecurringSeriesId`/`IsRecurring` updated to the new meeting on re-link (Api.Integration cross-series test).
  - [x] Optimistic badge swap + reconcile-on-error — reuses the existing `useLinkNoteToCalendar` hook; "Change" button opens `MeetingPicker` defaulted to the linked meeting's day.

  As-built deviations:
  - **API:** reused `POST /notes/{noteId}/calendar-link` (made idempotent, dropped the already-linked 409) instead of a new `PUT` — fewer moving parts, frontend already wired.
  - **Replay safety (Hawk):** the unlink delete is **ownership-checked** (`DeleteForNoteAsync`, DynamoDB `ConditionExpression NoteId=:noteId`) so a stale/replayed unlink can't clobber a link another note has since made to the freed meeting; proven by a DynamoDB-Local test (the in-memory double can't).
  - **E2E consciously skipped:** the meeting picker needs Google OAuth not present in the E2E gate (why no calendar journey exists). The badge swap is client-optimistic and the only projector-backed read affected (the meetings list's `linkedNoteId`) is pre-existing — so no *new* async read flow was introduced. Covered by Api.Integration (re-link, old-meeting-freed, idempotent, cross-series) + vitest.

### 44-B — Unlink a note from its meeting
- **Commands/events:** `UnlinkNoteFromCalendarEvent` → `NoteUnlinkedFromCalendarEvent` (reuses the event added in 44-A). Idempotent when already unlinked.
- **API:** `DELETE /notes/{noteId}/calendar-link` (idempotent; 200/204 even if not currently linked).
- **Projection:** reuses 44-A's `NoteUnlinkedFromCalendarEvent` arm (delete row, clear both keys).
- **Web:** "Remove"/"Unlink" action on the badge; optimistic clear → badge reverts to "Link to meeting"; reconcile-on-error. Confirm note title/body/tags/to-dos untouched (link removal only).
- **Tests:**
  - Domain spec: linked note → unlink → `_calendarEventId` null; unlink-when-unlinked is a no-op.
  - `Api.Integration`: `DELETE` clears the link; `GET /notes/{id}` shows no meeting; note content unchanged.
  - `Browser.E2E`: link → unlink → reload, reload-tolerant assert badge gone.
- **Acceptance criteria:**
  - [ ] BDD spec first.
  - [ ] `UnlinkNoteFromCalendarEvent` command + `DELETE` endpoint; idempotent.
  - [ ] Optimistic unlink + reconcile-on-error.
  - [ ] Note content provably untouched (assert title/body/tags/to-dos).

### Observability (run `observability-brief` to finalise)

Silent failure modes to instrument:
- **Re-link succeeds but the old meeting isn't freed** — the reverse `calendarEventId` key not cleared → old meeting still shows "Open Note" pointing at a moved note. → projection deletes both keys; structured log on re-link with `noteId`, `previousCalendarEventId`, `newCalendarEventId`.
- **Re-link/unlink 200s but stale on reload** — `CalendarLinkView` projector lag (if async). → optimistic UI + reload-tolerant read; do not authorize/decide off a lagging projection.
- **Optimistic swap/clear masks a failed write** — reconcile on error; surface a toast; revert the badge.
- **Recurring series drift** — `RecurringSeriesId` not updated on cross-series re-link → "next occurrence" computes against the wrong series. → assert series id in the round-trip + log it.
- **Idempotency holes** — unlink-when-unlinked or re-link-to-same-meeting must not throw or corrupt the index.

### Deploy-time
- **Neutral.** No new table, no new infra, no projection backfill (reuses `CalendarLinkView`). Backend + web change only; no change to the deploy path itself.
