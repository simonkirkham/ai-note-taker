# Learnings — Slice 11-H: Fix note not deleted when discarded from meeting creation

## Root cause

`MeetingsSection.handleCreateNote` called `onOpenNote(noteId, meeting.title)` without passing `isNew: true`. In `App.tsx`, `onOpenNote` set `setView({ kind: "note", noteId, initialTitle: title })` without `isNew`, so `NoteView` treated the freshly-created meeting note as an existing note. Cancel triggered `onBack()` rather than `onDelete(noteId)`, leaving the note in the list.

## The fix: thread `isNew` as an optional third param

`MeetingsSection.onOpenNote` was updated to a 3-param signature:

```typescript
onOpenNote: (noteId: string, title?: string, isNew?: boolean) => void
```

Both create call sites pass `isNew: true`:
- `handleCreateNote`: `onOpenNote(noteId, meeting.title, true)`
- `handleCreateNextOccurrenceNote`: `onOpenNote(noteId, undefined, true)`

`App.tsx`'s lambda threads it through:
```typescript
onOpenNote={(noteId, title, isNew) => setView({ kind: "note", noteId, isNew, ...(title ? { initialTitle: title } : {}) })}
```

## TypeScript prop type changes require grepping ALL parent declarations

Changing `MeetingsSection.onOpenNote` from 2 to 3 params without updating `ListView.tsx`'s declaration of the same prop type caused a TypeScript error caught only at CI/deploy time (PR #87 hotfix). `ListView.tsx` declared:

```typescript
// Before — 2 params:
onOpenNote: (noteId: string, title?: string) => void;
```

**Rule:** After any prop signature change:
1. `grep -rn "<prop-name>"` to find all parent components that declare or pass the prop
2. Update their type declarations
3. Run `npm exec -- tsc -p web/tsconfig.app.json --noEmit` before pushing

See memory `feedback_typecheck_before_merge` for the project-level rule.

## Prop signature changes propagate through the component tree

The `onOpenNote` prop flows: `App.tsx` → `ListView.tsx` → `MeetingsSection.tsx`. Changing the leaf (`MeetingsSection`) requires updating the entire chain. Grep is the only reliable way to find all declaration sites — searching for just `onOpenNote` shows three files that all needed updating.
