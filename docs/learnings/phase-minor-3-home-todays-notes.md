# CHANGE-3 — Home screen shows today's notes by default

**Shipped:** PR #101, deployed 2026-06-02.

## What changed
The home note list now shows notes whose **effective date is today** plus anything **edited today**, always hiding **future-dated** notes. A "Show older notes" toggle reveals past notes. Visible notes are ordered reverse-chronologically by effective date, `lastModifiedAt` descending as the tiebreaker. Folder views are unchanged (all notes, no toggle).

- Backend: `MapCardToResponse` now serialises `lastModifiedAt` (already on the `NoteCardView` projection — no new event, no rebuild). `NoteCard` frontend type gained the field; one Api.Integration assertion added.
- Frontend: new pure helpers in `web/src/dates.ts` (`effectiveDate` / `isEditedToday` / `localTodayISO` / `localDateISO`); `ListView` home-branch filter + sort + always-visible toggle + empty-state copy; optimistic new-note card carries `lastModifiedAt`.

## Technical notes
- **Local calendar date, not UTC.** `localDateISO` uses `getFullYear/getMonth/getDate` and compares `YYYY-MM-DD` strings, so "today" matches the user's wall clock near midnight. (The pre-existing note-date default in `App.tsx` still uses the UTC slice — out of scope, left alone.)
- **Future-hidden wins over edited-today**: a single early `if (eff > today) return false` guard enforces it; covered by a test in both toggle states.
- The `lastModifiedAt` tiebreaker compares ISO strings lexicographically — valid only because both the backend (`DateTimeOffset`) and the optimistic card (`new Date().toISOString()`) emit canonical UTC ISO-8601 (`Z`-suffixed). A comment notes this (Hawk suggestion).
- **Required-field cascade:** making `lastModifiedAt` required on `NoteCard` forced updates to every card literal/fixture (App.tsx optimistic card + 4 test fixtures). Tests that render the home list (`TagFilter`, `NoteCardDelete`) had their fixtures re-dated to *today* so they exercise their real concern (tags/delete) rather than tripping the new date filter.

## Tests
`dates.test.ts` (7) + `ListView.test.tsx` (10) cover every acceptance scenario incl. future-hidden-both-states, edited-today inclusion, null-date `createdAt` fallback, empty-state-with-toggle, tag-filter composition, folder-view-unaffected. Full suite 201 green; backend NoteCards integration 17 green.
