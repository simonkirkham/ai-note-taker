# 19-E — Effect hygiene (YMNNAE): "read from the same hook" only dedupes for React Query

**Slice:** 19-E #3 (PR #285, deploy #576, 2026-06-13). #1/#2 deferred.

## The trap

A "notify-parent-in-effect" (YMNNAE) cleanup replaces `child → onXChange(value)` (fired from a `useEffect`) with "the parent reads the value from the same hook the child uses." The spec assumed all three targets dedupe this way: *"parent reads its own hook instance, same cache key → same request."*

That is **only true for React Query hooks.** It is false for a stateful per-instance hook.

| Hook | Backing | Two instances → |
|---|---|---|
| `useActions(noteId)` | `useQuery`, key `keys.actions(noteId)` | **Deduped** — one fetch serves both subscribers; `queryFn` (and its `clearLatestToken` token-consume) runs once per fetch regardless of subscriber count |
| `useTranscription(noteId)` | `useState`/`useRef` + Transcribe streaming client + audio worklet | **Two independent recording sessions** — the parent's instance is idle, the child's does the recording; `startRecording`/`stopRecording` act on different state |

So #3 (ActionsSection count, React Query) was a clean two-line lift. #1/#2 (RecordControl status/transcript, streaming hook) cannot be done by having `NoteView` call `useTranscription` too.

## The rule

- **Before "lift the read to the parent," check what backs the hook.** If it's React Query (or any shared external store keyed by id), two call sites dedupe — safe. If it owns per-instance state (`useState`/`useRef`, a socket, a timer, a media stream), a second call site is a second machine, not a second view of one.
- **Correct fix for a stateful hook:** lift the hook itself into the lowest common ancestor (one instance), pass its values + actions **down** as props (controlled child). That changes the child's prop contract — bigger than a "read it yourself" swap, so it's a re-spec, not a drop-in.

## What shipped vs deferred

- **#3 shipped:** `NoteView` reads action count from its own `useActions(noteId)`; dropped `ActionsSection`'s `onCountChange` prop + effect and `NoteView`'s `actionCount` state. Guard: `NoteView.test.tsx` "action items loading reveals Save and Delete" stays green (hasContent still true from count alone).
- **#1/#2 deferred:** lift `useTranscription` into `NoteView`, make `RecordControl` controlled. Re-spec first.
