# 19-E — Effect hygiene (YMNNAE): "read from the same hook" only dedupes for React Query

**Slice:** 19-E #3 (PR #285, deploy #576, 2026-06-13). #1/#2 (PR #288, deploy #587, 2026-06-14).

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

## What shipped

- **#3 (PR #285):** `NoteView` reads action count from its own `useActions(noteId)`; dropped `ActionsSection`'s `onCountChange` prop + effect and `NoteView`'s `actionCount` state. Guard: `NoteView.test.tsx` "action items loading reveals Save and Delete" stays green (hasContent still true from count alone).
- **#1/#2 (PR #288):** lifted `useTranscription` into `NoteView` (single instance); `RecordControl` is now controlled via a `transcription: UseTranscriptionResult` prop. Removed both upward callbacks + their effects (RecordControl 3 effects → 1). NoteView derives `isRecording` + the status-gated `liveTranscript` + `displayedTranscript` directly.

## Bonus: derive, don't retain

The old `liveTranscript` was effect-pushed parent state, never reset on `→ idle`/`→ error`, so at `error` it displayed the last *live* transcript instead of falling back to the committed `transcriptText`. Deriving it (`liveTranscript = gate(status) ? transcription.transcript : null`) makes the stale-retain bug structurally impossible — another reason to prefer derived values over effect-mirrored state.

## Test pattern for a lifted stateful hook

- **Controlled child (`RecordControl`):** keep the REAL hook in a tiny test `Harness` that owns `useTranscription` and passes it down, so streaming/checkpoint/resume paths stay genuinely exercised — don't downgrade to a static prop object.
- **New owner (`NoteView`):** `vi.mock` `useTranscription` with a *stateful* stand-in (real `useState`, `startRecording` flips status→recording) so tests drive the parent's derived state for real, not trivial prop pass-through.
