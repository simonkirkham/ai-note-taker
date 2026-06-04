# Phase 16-A — Browse meetings by date on the home screen

**Deployed:** 2026-06-04 (deploy run #461, squash commit `b34d0f9`, PR #165)

Generalised the today-only meetings read path to an arbitrary day and added date navigation to the home-screen meetings section, end to end (calendar client → `/calendar/{date}` endpoint → `MeetingsSection`), while keeping meeting reminders pinned to the real today.

## What shipped

- **Calendar client.** `IGoogleCalendarClient.GetTodaysEventsAsync(tz)` → `GetEventsForDayAsync(DateOnly date, string tz)`; the local-day window is built from the passed date in `tz`, not `UtcNow`. `StubGoogleCalendarClient` filters to events on the requested day in the caller's tz. `GetNextOccurrenceAsync` left relative to `UtcNow`.
- **Endpoint.** `GET /calendar/today` → `GET /calendar/{date}?tz=` (ISO `YYYY-MM-DD`); malformed date ⇒ `400 { error = "invalid_date" }` with a debug log; `tz` guard preserved; handler renamed `GetTodaysMeetings` → `GetMeetingsForDate`. Resolved local-day window logged per fetch for off-by-one diagnosis.
- **Frontend.** `api.ts` `getMeetingsForDate(tz, date)`; `MeetingsSection` gained prev/next buttons, a date picker behind a calendar button, and a day-reflecting heading (Today / Tomorrow / Yesterday / `Meetings — EEE, d MMM`). Reminders fed by a dedicated *today* fetch, never the browsed day; the displayed list reuses that fetch when the selected day is today.

## Learnings

### 1. Synchronous `setState` in a `useEffect` body fails CI lint (`react-hooks/set-state-in-effect`)

The first cut reset/loaded the browsed-day state by calling `setBrowsedState(null)` / `setBrowsedState({status:'loading'})` directly in the effect body. `tsc` and `vitest` were both green, but `eslint` (which the pre-commit hook and CI both run) flagged it as a cascading-render smell.

**Fix pattern:** don't store transient "reset" / "loading" states that an effect must set synchronously — **derive** them. Key the fetched state by what it's for (`{ date, state }`) and compute the display:

```ts
const displayState = isToday
  ? todayState
  : browsed?.date === selectedDate ? browsed.state : { status: "loading" };
```

The effect then only ever calls `setState` inside its async `.then` callback (allowed), never synchronously in the body. The early-return `if (isToday) return;` replaces the synchronous `setBrowsedState(null)`.

**How to apply:** run `npm run lint` on changed frontend files during the Refactor step, not just `tsc`/`vitest` — the React-hooks rules only surface under eslint and are a hard CI gate. (Captured as a CLAUDE.md frontend guardrail.)

### 2. A dedicated side-effect fetch is the clean way to decouple "displayed" from "acted-on" data

The spec's highest-risk item was reminders silently following the browsed day. The robust shape: one state slice (`todayState`) is the *single* source for `useMeetingReminders` and is fetched once on mount, keyed `[tz, today]`; a separate slice backs the *displayed* list. Navigation only ever touches the displayed slice. The test that proves it asserts **both** the positive (reminder hook saw today's meeting) and the **negative** (never saw the browsed day's meeting) — the negative assertion is what makes it a real guard rather than a smoke test.

### 3. `npm install` in a fresh worktree rewrites `package-lock.json` under Node 24 even with no dependency change

Breaker's `npm --prefix web install` (Node 24 / npm 11 locally) rewrote `package-lock.json`, dropping optional native-binding entries that CI's Node 20 `npm ci` expects. No packages were added, so the right move was to `git checkout -- web/package-lock.json` before commit. Reinforces the existing CLAUDE.md guardrail — only commit a regenerated lock file when the local Node matches CI (20), and only when dependencies actually changed.

## Done actions applied this turn

- Added a CLAUDE.md frontend guardrail: never call `setState` synchronously in a `useEffect` body — derive transient state instead (trips `react-hooks/set-state-in-effect`, a hard CI gate).
