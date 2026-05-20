# Phase 10-C — Persist Transcript Learnings

## 1. `react-hooks/set-state-in-effect` + `react-hooks/no-refs-in-render` — two rules, one pattern to avoid

Calling `setState` synchronously inside a `useEffect` body triggers `react-hooks/set-state-in-effect` (cascading-render concern). Reading `ref.current` during render triggers `react-hooks/no-refs-in-render`. Both rules fired when the first attempt used `useState` + `useEffect` to track "has a recording started this session".

The correct pattern: `useState` with the setter called directly in the event handler (the Record button's `onClick`). Event-handler state updates are batched with the event, avoid effect indirection, and satisfy both lint rules.

```tsx
// Wrong — both rules fire
const [recorded, setRecorded] = useState(false);
useEffect(() => { if (status === 'requestingCredentials') setRecorded(true); }, [status]);

// Wrong — no-refs-in-render fires
const recordedRef = useRef(false);
const show = !recordedRef.current; // reads ref during render

// Correct
const [recorded, setRecorded] = useState(false);
onClick={() => { setRecorded(true); startRecording(); }}
```

## 2. Missing `catch (InvalidOperationException)` — silent 500 on deleted notes

`Note.HandleCompleteTranscription` throws `InvalidOperationException` when the note doesn't exist. `TranscriptionHandlers.CompleteTranscription` only caught `NoteNotFoundException`. In the happy-path-first projection guard (`detail is null → 404`) this was hidden, but a delete-between-check-and-dispatch race would produce a 500.

Pattern: any command handler that touches a Note aggregate must catch both `NoteNotFoundException` and `InvalidOperationException` and map both to 404. This is consistent with `DeleteNote` and `UntagNote`. Add to the pre-PR checklist: "Does every command handler catch all exceptions the aggregate can throw?"

## 3. Missing namespace on new contract files — compiles globally but breaks conventions

`CompleteTranscriptionRequest.cs` was created without `namespace Api.Contracts;`. It compiled because C# implicit global using resolved it, but the handler referencing it needed a `using` directive added after the namespace was put back. Easy miss when scaffolding a new file in an existing directory.

Pre-PR checklist item: verify every new `.cs` file in `src/Api/Contracts/` has `namespace Api.Contracts;` as its first line.

## 4. Both stop paths must call `completeTranscription` — test both

`useTranscription` has two paths that end recording: the Stop button and the natural end-of-stream (the `for await` loop exits when AWS closes the stream). Both must call `completeTranscription`. The Stop-button path has an obvious test. The natural-end path needs its own test using a finite mock stream via `vi.mocked(TranscribeStreamingClient).mockImplementationOnce` with an async generator that ends naturally:

```ts
vi.mocked(TranscribeStreamingClient).mockImplementationOnce(() => ({
  send: vi.fn().mockResolvedValue({
    TranscriptResultStream: (async function* () {
      yield { TranscriptEvent: { ... } }
      // stream ends here
    })(),
  }),
}) as unknown as TranscribeStreamingClient)
```

## 5. `initialTranscript` stale-display after Reset — suppress with session flag

A `TranscriptionPanel` that receives `initialTranscript` from a parent (loaded from the API) shows it in idle state. After Reset, status returns to idle but `initialTranscript` is still the old saved value from the parent's state — the panel re-shows stale text. Fix: `useState(false)` flag set in the Record button `onClick`; only display `initialTranscript` when `!hasRecordedThisSession`. The flag is intentionally never reset — it guards the prop for the component's lifetime.

## 6. Empty `transcriptText` must be validated server-side

The browser `if (text)` guard in `useTranscription` prevents posting an empty transcript, but a direct API call bypasses it. Without a server-side guard, an empty string would be stored in the aggregate event and silently dropped by the DynamoDB conditional (`!string.IsNullOrEmpty`), leaving the projection inconsistent with the event log. Add `if (string.IsNullOrWhiteSpace(req.TranscriptText)) return Results.UnprocessableEntity()` before the projection lookup — not after — so the 422 fires before any DynamoDB read.
