# 23-E Workspace Switcher — Prototype REFERENCE

Throwaway prototype (branch `prototype/23-e-workspace-switcher`). The real slice rebuilds
from scratch using the GWTs in `docs/phases/phase-23.md` + this file. **Do not copy prototype code.**

## Confirmed UX

**Placement — Variant A: sidebar dropdown.**
- A button at the **top of the sidebar** shows the active workspace name + a `▾`. Click toggles a popover.
- The popover lists every workspace; the active one shows a `✓` and a highlighted (indigo) row.
- Clicking a workspace name **switches** to it and **closes** the popover.

**CRUD — Style 1: inline (no modals).**
- **Create:** a `+ New workspace` row at the bottom of the popover → becomes an inline text input → Enter creates the workspace, **switches into it** (optimistic), and closes the popover. Escape/blank cancels.
- **Rename:** a `✎` per row → the name becomes an inline input (pre-filled) → Enter or blur saves. Optimistic.
- **Delete:** a `🗑` per row → **immediate** delete (no confirmation dialog). Optimistic removal.
  - If the workspace is **not empty** (holds an active note) → the API returns 409; show an **inline red error** inside the popover ("Workspace is not empty — move or delete its notes first."), and roll back the optimistic removal.
  - The **default "Personal" workspace** shows **no `🗑`** (rename `✎` is allowed).
- Switching workspaces clears any inline error.

## Real-world wiring (vs prototype)

The prototype used mock `localStorage` state. The real slice uses what already exists:
- **Data:** `GET /workspaces` (23-A) via a TanStack `useWorkspaces` query (`keys` add a `workspaces` key — global, not workspace-scoped since the list itself is global). `WorkspaceListView` → `{ workspaceId, name, isDefault }`.
- **Mutations:** `POST /workspaces` (create), `PATCH /workspaces/{id}` (rename), `DELETE /workspaces/{id}` (delete) — all 23-A. Optimistic create/rename/delete with rollback on error, mirroring the existing `useFolderMutations`/`useNoteMutations` pattern. The DELETE surfaces the 409 (`WorkspaceNotEmptyException`) as the inline error.
- **Switch:** `navigate('/w/{id}')` — routing + `WorkspaceProvider` cache-reset already exist (23-D). Create-then-switch = create, then `navigate('/w/{newId}')`.
- **Default no-delete:** hide `🗑` when `workspaceId === '__default__'` (or `isDefault`).

## Component decisions
- A `WorkspaceSwitcher` component placed at the top of `Sidebar`. A popover toggled by local `useState(open)`; close on outside-click and on pick (match existing sidebar menu patterns).
- Inline create/rename inputs are local component state, not a modal.
- Reuse the app's design tokens / CSS Modules (the prototype used inline styles — discard those).

## Optimistic-UI acceptance (mandatory)
- Create: the new workspace appears in the list and the app navigates into it immediately, before the POST resolves; on error, remove it and surface an error.
- Rename/delete: reflect immediately; roll back on error (delete's 409 → inline error + restore the row).

## localStorage keys (prototype only — not used by the real slice)
- `proto23e-workspaces`, `proto23e-active`.
