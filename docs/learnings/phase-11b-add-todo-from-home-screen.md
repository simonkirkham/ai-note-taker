---
name: phase-11b-add-todo-from-home-screen
description: Learnings from slice 11-B — standalone to-do aggregate, unified projection, optimistic quick-capture UI
metadata:
  type: project
---

# Phase 11-B — Add To Do from Home Screen

## Unifying heterogeneous streams in a single projection needs explicit stream routing

Two event streams (`todo#…` and note-stream GUIDs) both feed `TodoListEventHandler`. Routing is done by checking whether `streamId.StartsWith("todo#")` at the top of `HandleAsync`. Without this, `EventDeserializer.Deserialize` would silently swallow unknown events, and the projection would appear to work but produce incorrect data.

**Why:** The projection was designed after the event streams were already in production. Adding a new stream type without changing the fan-out infrastructure means routing must live in the handler, not the dispatcher.

**How to apply:** Whenever a new aggregate's events join an existing projection, add a stream-prefix check at the top of the event handler before dispatching to type-specific cases.

---

## Optimistic add with tempId swap prevents duplicate display on re-fetch

The `QuickCaptureTodoInput` component uses `temp-${Date.now()}` as a placeholder `itemId` before the API responds. On success, `onConfirmed(tempId, realId)` is called so `TodoSection` can swap the id in state. Without the swap, if `getTodos` fires again (tab remount, reconnect), the API returns the real id and `handleOptimisticAdd` can't find the `tempId` to replace — creating a duplicate.

**Why:** This was caught by Hawk in code review. The original implementation had a comment saying "real ID differences don't matter for display", which is only true for the current render but breaks on re-fetch.

**How to apply:** Every optimistic add that generates a client-side temporary ID must expose an `onConfirmed(tempId, realId)` callback and call it on success. The parent component is responsible for the id swap.

---

## Always add GetByIdAsync for ownership checks — never QueryAllAsync

`OwnsTodoAsync` was initially implemented by calling `QueryAllAsync` and filtering in memory — an O(n) full-table DynamoDB scan per mutating request. After Hawk's review, `GetByIdAsync` was added to `ITodoListStore` and both implementations (DynamoDB `GetItemAsync` with PK, in-memory dict lookup). This reduced the ownership check from O(n) to O(1).

**Why:** Ownership checks run on every mutation. A full scan is invisible at small scale but will be expensive in production and is never the right pattern when a direct key lookup exists.

**How to apply:** When adding a new projection store, include `GetByIdAsync(string id)` as part of the initial interface — don't wait for a code review to surface the missing method.

---

## Optimistic rollback must capture original state before mutation, not reconstruct it

`handleReopen` initially rolled back by setting `completedAt: new Date().toISOString()` — a freshly minted timestamp, not the item's original value. The correct pattern: capture `const originalCompletedAt = item.completedAt` before the optimistic update and restore that specific value in the catch block.

**Why:** Reconstructing "what the state was before" from current knowledge is always wrong — time has passed and you are guessing. Snapshot-before-mutate is the invariant.

**How to apply:** In every optimistic handler that clears a field (reopen clears `completedAt`, delete removes an item), capture the original value as a `const` immediately before the `setItems` call.

---

## MSW delay() is needed when testing optimistic-then-rollback in the same render cycle

The rollback test (`rolls back optimistic item on API failure`) initially used a synchronous MSW failure handler. React batched the `onAdded` state update and the `onFailed` rollback into a single render — `findByText('Call dentist')` timed out because the item was never observable in the DOM. Adding `await delay(20)` to the MSW handler gives React a render cycle to show the optimistic state before the rollback fires.

**Why:** MSW handlers that return synchronously resolve before React flushes batched state. The optimistic add and the rollback effectively happen in the same update batch.

**How to apply:** Any test that needs to assert an intermediate optimistic state before an API failure must add `await delay(N)` (from msw) to the failure handler to ensure the intermediate render is observable.

---

## Task.WhenAll for independent DynamoDB updates

`UpdateNoteTitleAsync` was originally a sequential `foreach` over `UpdateItemAsync` calls — one await per note sharing the title. Since the calls are independent (different PKs, no ordering dependency), they should run concurrently:

```csharp
await Task.WhenAll(itemIds.Select(id => dynamo.UpdateItemAsync(..., ct))).ConfigureAwait(false);
```

**Why:** Sequential foreach adds latency proportional to N. This is explicitly called out in the project guardrails.

**How to apply:** Any time a loop calls an async method with a different input on each iteration and no ordering dependency, replace the loop with `Task.WhenAll(items.Select(...))`.

---

## UTC vs local-day mismatch in date filtering — extend backend cutoff, filter authoritatively on frontend

The backend `GetTodos` initially filtered completed items to `completedAt.UtcNow.Date` — a UTC-midnight boundary. The frontend `isToday` checks the user's local calendar day. A UTC-5 user completing a task at 11 PM local time stores `completedAt` as ~4 AM UTC next day. The backend would include it; the frontend's `isToday` check correctly classifies it as "today". But the reverse also exists: an item classified as "today" by the frontend might be filtered out by the backend after UTC midnight rolls over.

**Fix:** Extend the backend cutoff to `UtcNow.Date.AddDays(-1)` (2-day window), covering all UTC-offset timezones. The frontend `isToday` remains the authoritative filter. The backend is now a loose pre-filter, not the source of truth for "today".

**Why:** Client and server can never agree on "today" without timezone info from the client. The right architecture is: server returns a generous window, client applies the precise local filter.

**How to apply:** Any time the backend needs to filter by "current day", either accept a timezone from the client or use a multi-day window and delegate the precise boundary to the frontend.
