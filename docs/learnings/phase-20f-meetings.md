# Phase 20-F — Meetings TanStack Query migration

Migrated the meetings domain (`getMeetingsForDate` + the create/link mutations) to TanStack Query. PR #197. Clean deploy + E2E (the 20-C lessons held — see [[phase-20c-note-cards]]).

## Two date-keyed queries make a "today-anchored + browseable" decoupling structural

Phase 16 required: meeting **reminders** stay anchored to *today* even while the user **browses** other days. The hand-rolled version did this with two `useState`s (`todayState` sticky + `browsed` transient) and two guarded effects. TanStack collapses it to **two date-keyed queries**:
- `useMeetings(today)` — always mounted; `reminderMeetings` derives **only** from its data → reminders can never be fed the browsed day, *regardless of anything else*. The decoupling is now structural, not an imperative guard you can forget.
- `useMeetings(selectedDate)` — drives the display. Same key as the today query when `selectedDate === today` → React Query dedups to one fetch; a distinct key when browsing, leaving today untouched.

Reusable pattern: when one consumer needs a *fixed* parameter (today) and another needs a *variable* one (selectedDate), give each its own `useQuery(key(param))` rather than one query + manual "which param is live" state. Dedup, caching, and decoupling all fall out.

## Bake a "don't refetch on return" guarantee into the hook's staleTime — it's also what the test can pin

The "returning to today doesn't refetch" guarantee depends on the today query still being **fresh** when its observer reactivates. Relying on the *global* `QueryClient` staleTime is fragile two ways: (1) the test render helper sets `staleTime: 0` (only `retry:false`), so the no-refetch test would fail against it; (2) a future 20-G change to the global default could silently weaken it. Fix: set `staleTime: 30_000` **on `useMeetings` itself**. Now the guarantee is intrinsic, and the no-refetch test (which counts today fetches across away-and-back, under a staleTime-0 test client) genuinely **pins the hook's own staleTime** — a real regression is caught.

**20-G note:** do NOT "consolidate" `useMeetings`'s per-hook `staleTime` into the global `QueryClient` default — the test relies on the hook carrying it.

## A discriminated-union "unavailable" is a loaded state, not a query error

`getMeetingsForDate` returns `{ meetings } | { error }`. The `{ error }` arm (calendar not connected) is a **successful 200** carrying an unavailable marker — it must read as `data`, so `useQuery` never enters its error/retry state (no retry-spin on an expected "unavailable"). A thrown fetch (network/5xx → `data` undefined) is the *real* error and retries per defaults. `toState(query)` folds both undefined-data and `"error" in data` to `"unavailable"`. Keep the union in the data; don't map `{error}` to a thrown error.

## Caller-owned optimism (a justified divergence from the 20-A template)

20-A/20-B/20-C put optimism + `cancelQueries` snapshot + rollback **inside** the mutation hook (`onMutate`/`onError`). 20-F's `useMeetingMutations` deliberately owns only the API call + cross-domain invalidation, pushing optimism to each **call site** — because it differs per site: `MeetingsSection` patches the meetings cache (`setQueryData`), while `NoteView` keeps local `linkedMeeting`/`recurringSeriesId` component state. This is the right call when one mutation has structurally different optimistic targets per caller, but it means these mutations skip `cancelQueries` before patching (benign here: the create flow navigates away; the next-occurrence flow patches-then-awaits). Recorded as a deliberate choice, not drift.

## Boundary + carry-forward for 20-E / 20-G

- NoteView's `handleLinkMeeting`/`handleOpenNextOccurrence` use the new hooks but keep **local** `linkedMeeting`/`recurringSeriesId` optimism; `keys.note` invalidation is **deferred to 20-E** (note-detail not yet a query — invalidating it now is a no-op). 20-E should add `keys.note` invalidation to these mutations.
- **Coverage gap (Hawk nit, deferred):** no test for the `MeetingsSection` next-occurrence optimistic rollback; the NoteView link-failure rollback *is* covered by an existing NoteView test. Add the next-occurrence rollback test in 20-G.
