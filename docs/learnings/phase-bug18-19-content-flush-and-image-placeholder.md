# BUG-18 / BUG-19 — content flush on leave; image placeholder before resolve

**Slice:** BUG-18 (data loss, High) + BUG-19 (403 flash, Low), shipped together in PR #232, deploy #520, 2026-06-11.
**Trigger:** user report — "remove an image, hit save, reopen → image is back" + a 403 on the image URL.

## What broke

| # | Defect | Root cause |
|---|--------|------------|
| BUG-18 | An inline-image removal (and any un-blurred edit) was not persisted | Note content saved from **one** place — the editor's `onBlur`. The Save button just navigates; it works for typed text only because moving focus blurs the editor first. The image ✕ control `preventDefault`s mousedown to keep selection, so it never blurs the editor; on a freshly-opened note (focus on the title) the removal updated `contentDraft` but no save ever fired. |
| BUG-19 | 403 + broken-image flash on every open | `ImageNodeView` rendered the bare S3 key (`notes/{id}/{img}.png`) as `<img src>` before `resolveImages` swapped in a presigned URL. The browser resolved the key relative to the SPA route `/notes/{id}` → `/notes/notes/{id}/{img}.png` → 403. |

## Lessons (the non-obvious bits)

1. **A save triggered only by blur is a latent data-loss bug.** Any control that suppresses focus change (here `onMouseDown preventDefault`, common for in-editor buttons) bypasses a blur-only save. Persist pending edits on **leave and unmount**, not solely on blur. The draft-pattern state existed; the missing piece was a flush when the component goes away.

2. **A mutation test that never establishes the precondition proves nothing.** The 25-D E2E removed an image that was **never persisted to server content**, so the removal `PUT` was `"" == ""` — a backend no-op (`Note.HandleEditContent` returns `[]` on unchanged content) — and the test passed green while the real bug shipped. A removal/edit test must first persist the thing it removes, then remove, then reopen and assert against the **server** state. The fixed journey saves-with-image → reopen → remove → save → reopen.

3. **`notes/notes/…` was a red herring.** The doubled segment was browser relative-URL resolution of a bare key against the SPA route, not a malformed stored key — confirmed by reading the prod `notedetail` content (the stored key was the correct single-prefix). Diagnose a suspicious URL by checking what's actually stored before assuming the writer is wrong.

4. **Diagnosing flaky persistence from the event stream.** The prod event history was decisive: image added at v14 (07:26), note reopened/renamed twice with it still present, removal only persisted at v17 (09:02). The ~1.5h gap with intervening reopens is the signature of "save fired only sometimes" — far stronger evidence than reasoning about the code alone.

5. **`react-hooks/refs` forbids reading/writing `.current` during render.** Mirroring `contentDraft` into a ref and pointing a `saveContentRef` at the latest closure both had to move into effects (`useEffect(() => { ref.current = … })`), not run inline in the component body. `tsc`/`vitest` don't catch this; `eslint` does, and lint is a hard CI gate — run `npm run lint` on changed frontend files, not just typecheck.

## Fix shape (reusable)

- One ref-guarded saver used by blur **and** leave **and** unmount: read draft from a ref, **clear the ref before mutating** (so blur+leave / Save+unmount can't double-fire), **restore the ref in `onError`** (so a later leave retries the kept text), `onSuccess` nulls the draft state.
- A `deletingRef` set synchronously in every delete entry point gates the unmount flush off when the note is being deleted (don't save a note you're deleting).
- For an async-resolved asset, never render the unresolved identifier as a fetching `src` — render a placeholder until it resolves (`unresolved = !src || isImageKey(src)`).

## Process improvement applied this slice

- Closed the E2E no-op gap (lesson 2) in `NoteImageJourney.cs` as part of the fix.
- Hawk caught a narrowed reincarnation of the same loss class (error path nulled the ref permanently); fixed + guarded with a test in the same PR.
