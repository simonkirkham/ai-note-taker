---
name: phase-9d-create-note-from-meeting
description: Learnings from slice 9-D — one-click create note from a meeting
metadata:
  type: project
---

# Learnings: 9-D — One-click create note from a meeting

- New props added to a shared component (`ListView.tsx`) will silently break test files that render the component but are outside the slice worktree. `tsc -p tsconfig.test.json --noEmit` catches this before push. **Action:** Added typecheck-test step to Pip's pre-PR checklist in `agent-roles.md` — Done.

- Cross-user isolation must be applied in both directions: the 409 guard (`POST /notes/from-meeting`) must scope by `UserId`, and the read path (`GET /calendar/today` linkMap) must also filter by `UserId`. Missing either direction exposes or blocks another user's data. **Action:** Added cross-user isolation audit (check both write guards and read projections) to Pip's pre-PR checklist in `agent-roles.md` — Done.

- React components need `try/catch` in async handlers that call external APIs; errors must flow into visible UI state, not disappear. **Action:** Documented in `agent-roles.md` under Pip's frontend checklist — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. tsconfig.test typecheck before push | Applied — added to Pip pre-PR checklist in `agent-roles.md` |
| 2. Cross-user isolation in both read and write paths | Applied — added to Pip pre-PR checklist in `agent-roles.md` |
| 3. Async handler error surfacing | Applied — added to Pip frontend checklist in `agent-roles.md` |
