# Learnings: 9-F next-occurrence title fix + StubGoogleCalendarClient

- **The fix/9f PR was merged before 11-H; 11-H's `MeetingsSection.tsx` squash-merged over the title fix, restoring `onOpenNote(noteId, undefined, true)`.** Three successive deploy failures resulted. **Action:** Before opening a fix branch PR, rebase it onto the latest main and check whether any in-flight PRs touch the same files — if so, either merge after them or coordinate the ordering. — Done (applied by rebasing and committing the final fix directly to main).

- **Hawk correctly flagged missing unit tests for `StubGoogleCalendarClient`.** The stub has non-trivial logic (date-boundary filtering, malformed-JSON fallback) that could regress silently. **Action:** Any new `IGoogleCalendarClient` implementation with logic beyond a dict lookup needs unit tests in `Api.Integration` — added five tests covering filtering, boundary exclusion, no-match, and error fallback — Done.

- **`onOpenNote` signature grew from 2 to 3 params across slices (9-D → 11-H) without a single-pass type audit.** `ListView.tsx` and `App.tsx` drifted out of sync, breaking the TypeScript build for three consecutive deploys. **Action:** When changing a shared callback type, grep all call sites and wrapper components in the same PR before pushing — TODO.

## Applied status

| Learning | Status |
|---|---|
| 1. Fix branch merge ordering | Applied — rebased and pushed title-fix directly to main |
| 2. Unit tests for StubGoogleCalendarClient | Applied — `tests/Api.Integration/StubGoogleCalendarClientTests.cs` (5 tests) |
| 3. Callback signature drift audit | Documented — requires a grep step added to the pre-PR checklist |
