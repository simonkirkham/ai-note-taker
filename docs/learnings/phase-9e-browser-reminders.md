# Phase 9-E learnings — Browser reminder hook and notification permission banner

## 1. Array reference identity kills useEffect — use a stable constant for the empty fallback

`useMeetingReminders` depends on `[meetings]` in its `useEffect`. When the component passes `[] ` as a literal (e.g. `state.status === "loaded" ? state.meetings : []`), every render creates a new array reference. `useEffect` uses `Object.is` — a new reference fails equality and tears down + re-registers all timers on every render, even though the array is logically empty.

**Fix:** declare a module-level constant `const NO_MEETINGS: MeetingReminder[] = []` and use that as the fallback. The constant has a single identity across all renders.

**Rule:** any hook with an array dependency must receive a stable reference. Document this contract with a comment on the hook. `useMemo` is an alternative but the constant is simpler.

**Done:** `NO_MEETINGS` used in `MeetingsSection.tsx`; comment added to `useMeetingReminders.ts`.

## 2. "default" and "denied" are meaningfully different permission states — handle them differently

`Notification.permission === "default"` means the user hasn't been asked yet. Showing an `alert()` at meeting time when they haven't decided is hostile: it interrupts them with no context. The correct behaviour is to skip silently for `"default"` (the permission banner is already visible) and only use `alert()` as a fallback for `"denied"` (they said no, so there's no better option).

**Done:** `fireReminder` in `useMeetingReminders.ts` now has an explicit three-way split: `granted` → `Notification`, `denied` → `alert()`, `default` → silent. Test updated to assert `alert` is NOT called when `default`.

## 3. Async permission API can throw — always dismiss the banner regardless

`Notification.requestPermission()` can throw in environments where the API is unavailable or called without a user gesture. If it throws and the banner code doesn't catch it, `setBannerDismissed(true)` is never reached — the banner stays visible with no error feedback.

**Fix:** wrap in `try/catch`; call `setBannerDismissed(true)` after the try/catch block so it always runs.

**Done:** Applied in `handleEnable`.

## 4. Parallel slices that share a component: stub resolves cleanly with rebase

9-B and 9-E both touched `MeetingsSection.tsx`. The agreed convention: 9-B owns the full implementation (meetings data fetch + rendering), 9-E owns the notification banner + hook integration. When 9-E rebased onto main after 9-B merged, the conflict was resolved by writing the merged component from scratch: 9-B's fetch/render + 9-E's banner + `useMeetingReminders(meetings)` wired to the real meetings array. The MeetingsSection test file was similarly merged (11 total tests covering both concerns).

**Rule:** for parallel slices sharing a component, document in the plan which slice "owns" the base and which "adds to" it. The adding slice does a clean rebase resolve rather than accepting either side.

## 5. Notification banner tests must stub permission state to isolate from other tests

JSDOM's default `Notification.permission` is `"default"`, which means any test that renders `MeetingsSection` without stubbing permission will see the banner — potentially interfering with assertions about meeting list content (e.g. a `getByText` query finding text inside the banner instead of the list).

**Fix:** add `beforeEach(() => stubNotificationPermission('granted'))` at the top of any describe block that tests non-banner behaviour.

**Done:** Applied to "MeetingsSection — meetings data" describe block.
