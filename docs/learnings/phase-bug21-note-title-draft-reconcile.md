# BUG-21 — note title silently lost on navigate in/out

**Slice:** BUG-21 · PR #258 (`279aef1`) · deployed 2026-06-13 (#547)

## What broke

A titled note (e.g. "Interview: Simon Kirkham") showed an empty title placeholder after navigating away and back, then the blank **persisted** to the event stream — silent, permanent data loss.

## Why — two faults compounded

| # | Fault | Effect |
|---|-------|--------|
| 1 | Title was `useState(initialTitle)` — seeded once, never reconciled with the loaded `detail.title`. | A nav path passing no title (`onOpenNote(noteId)`) fell back to a stale/empty card-cache title; the field showed `""` even though `detail.title` held the real value. |
| 2 | The title input auto-focuses on open; its `onBlur` persisted the value with **no empty guard** in `HandleRename`. | The first click/navigation blurred the empty field → `NoteRenamed("")` → the real title overwritten. |

Neither fault alone is fatal: #1 is a display bug, #2 is a write that "shouldn't" receive empty. Together they turn a benign navigation into destructive data loss.

## The generalisable lesson

1. **When you establish a "draft pattern" for editable fields, audit *every* editable field — a missed one is not merely stale-display, it can be actively destructive.** Content and date already used `draft ?? detail?.x`; title was the **one editable field not backed by `detail`**. The cost of the omission wasn't a cosmetic stale value — it was that the field's own blur-to-persist path wrote the stale value back. The audit question is not "does this field display correctly?" but "if this field's persist path fires with its current displayed value, is that always safe?"

2. **A write path that can persist a destructive value needs a domain guard regardless of the UI fix.** The frontend draft fix stops the empty value from ever being *shown*; the `string.IsNullOrWhiteSpace` no-op in `HandleRename` stops it from ever being *stored*, even if a future caller (or a different client) sends blank. Defence in depth: the UI fix removes the trigger, the domain guard removes the possibility.

3. **Auto-focus + blur-to-persist is a latent hazard.** An auto-focused input that persists on blur fires a write on the *first* interaction the user makes — before they have touched the field. If the field's initial value can be wrong (here: empty before `detail` loads), that write is wrong. Either don't persist unchanged/empty values, or don't auto-focus a persist-on-blur field.

## The fix (pattern to reuse)

- Title now mirrors content/date exactly: `title = titleDraft ?? detail?.title ?? initialTitle`; `handleSaveTitle` discards the draft (no PATCH) on empty/whitespace/unchanged and keeps the typed value on save failure.
- Rename routed through a new **keystone mutation** `useRenameNoteDetail` (patch `keys.note` on success, invalidate `keys.noteCards` on settle) — byte-for-byte the `useEditContent`/`useSetNoteDate` shape. This also retired the inconsistent cards-only `useRenameNote` (the only note-detail mutation that did optimistic-cards instead of keystone) and its `onRename` prop chain.
- `Note.HandleRename` no-ops on blank.

## Process notes (no spike)

- Merge gate was blocked ~15 min by an **unrelated** parallel-merge deploy failure (#546, PR #254 image-sizes) red-gated on the recurring `TagsJourney` E2E async-projection flake — `gh run rerun --failed` cleared it. This is the same flake family logged against BUG-14 / RYW-2; it taxes whichever slice happens to be waiting on the merge gate, not the slice that caused it.
- Hawk approved first round (no blockers; 3 nits, all left as-is: no unmount-flush for title — fine because a text input always blurs first; frontend/backend trim asymmetry — cosmetic; one untested equality branch).
