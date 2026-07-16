# BUG-47 — Stale-read content edit silently overwrote real notes

**Slice:** BUG-47 (PR #392). **Fix:** hash-based optimistic concurrency on note content edits.

## What happened (in prod)

A user editing a note hit Alt+← (browser back), the note showed **empty** on return, they retyped a remembered fragment, and their full 2134-char note became a 30-char stub. Event stream `note#c7b3b612`: `v5` (full, 09:04:06) → `v6` (fragment, 09:04:14). The full note was **never lost from the event store** — only overwritten in the read model. Recovered `v5` and restored it.

## The three-times-wrong diagnosis — and why

The mechanism was mis-diagnosed twice before the event history + one user sentence pinned it:

| Theory | Why it was wrong |
|---|---|
| "Save-on-back was aborted mid-request (teardown)" | The save **completed** — `v6` is a durable event. Not a lost write. |
| "The editor truncated to a fragment and saved it" | The fragment was the user **retyping** what they remembered, not an editor bug. |
| ✅ "Stale read → editor loaded empty → user retyped → overwrote real content" | The user's "I typed it a second time as it was the last thing I remembered" + the 8-second `v5→v6` gap confirmed it. |

**Lesson:** for an event-sourced "I lost my data", read the **event stream**, not the read model — the data is usually still there, and the stream's ordering + timestamps are what actually pin the mechanism. Do **not** ship a fix on the first plausible theory; each of the first two would have produced the wrong fix (a keepalive flush; an editor-truncation guard) — and a naive autosave, initially requested, would have made it **worse** (persisting the stale-empty state faster).

## Why hash-based, not version-based, optimistic concurrency

The guard sends the SHA-256 of the content the editor **loaded**; the aggregate rejects an edit whose base no longer matches its current `_content` (409 `stale_content`). Chosen over a stream-version token because:

- **No false conflicts.** A tag/date/title write between load and save bumps the stream version but does **not** change `_content`, so a version-based guard would spuriously 409. The content hash is unaffected — it only conflicts on a real content change. (Regression-tested: `AllowsEditWhenAnInterleavedTagWriteBumpedTheStream`.)
- **No new projection field.** A content-version would need a `NoteDetail` field mapped in both stores + a round-trip test + a projector change. The hash needs none — the client already has the loaded content.
- **Legitimate delete-all still works** — it carries the matching hash of what the user saw. The guard blocks only a *stale-base* overwrite, which is exactly and only the failure. (This was the user's explicit worry: a size/shrink guard would block real deletes; a hash guard does not.)
- **Guards against the event stream, not the async projection.** The check runs in the Command Lambda against the aggregate rebuilt from the stream (strongly consistent), so a stale-empty projection read reliably mismatches — avoiding the async-authz race class of BUG-30.

**Cross-language hash contract:** client (Web Crypto) and server (`NoteContentHash`) both pinned to the standard SHA-256 test vectors (empty, "abc"), so they cannot silently drift.

## An async step before a fire-and-forget write changes its timing

First cut computed the hash **inside** `handleSaveContent` (`await contentHash(...)` then `mutateAsync`). That deferred the PUT by a microtask — enough that a prior test's unmount-save PUT fired **after** its test ended and landed on the **next** test's msw handler, flipping a `putCalled` assertion (passed in isolation, failed in the full run).

**Fix:** precompute the base hash into a ref (`baseContentHashRef`) in an effect keyed on the loaded content, so the save fires **synchronously** — same-tick on blur/unmount, no deferred write.

**Lesson:** inserting an `await` before a fire-and-forget write (unmount flush, `pagehide`) is not free — it changes *when* the write fires, which breaks both same-tick teardown semantics in production and test isolation. Keep the pre-write async work off the save path (precompute), or the deferral leaks.

## jsdom has no `crypto.subtle`

Web Crypto's `crypto.subtle` is undefined under jsdom (only the app's HTTPS/localhost secure context has it). Restored Node's `webcrypto` in `web/src/test/setup.ts` so the real hash is exercised in tests rather than mocked.

## Deferred (accepted, low-reachability)

Two sub-millisecond windows Hawk flagged, both requiring a programmatic back-to-back content save (no such path exists; human focus+type+blur latency ≫ a microtask): the base-hash ref trailing a just-saved content by one tick, and a cold-load save before the first hash resolves (guard-skipped). Documented, not fixed — fixing adds async complexity for an unreachable case.
