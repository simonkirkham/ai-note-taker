import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { WorkspaceNotEmptyError } from "../api/workspaces";
import {
  useCreateWorkspace,
  useDeleteWorkspace,
  useRenameWorkspace,
} from "../hooks/useWorkspaceMutations";
import { useWorkspaces } from "../hooks/useWorkspaces";
import { useCurrentWorkspace } from "../workspace/context";
import { DEFAULT_WORKSPACE_ID } from "../workspace/workspaceStore";
import { useRequestLeave } from "./leaveGuardContext";
import styles from "./WorkspaceSwitcher.module.css";

// 23-E — sidebar workspace switcher (Variant A dropdown, inline CRUD). Self-contained:
// reads the workspace list + active id and owns its own popover/edit state.
export default function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const requestLeave = useRequestLeave();
  const wsId = useCurrentWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  const createM = useCreateWorkspace();
  const renameM = useRenameWorkspace();
  const deleteM = useDeleteWorkspace();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = workspaces.find((w) => w.workspaceId === wsId);
  const activeName = active?.name ?? (wsId === DEFAULT_WORKSPACE_ID ? "Personal" : "Workspace");

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      // close() (not setOpen(false)) so a stale 409 error / half-typed create /
      // in-progress rename doesn't survive the close and reappear on next open.
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setCreating(false);
    setNewName("");
    setRenamingId(null);
    setError(null);
  }

  // BUG-54: switching workspace leaves the note screen, so it asks first when a recording
  // is running. The popover only closes once the leave is agreed — declining should leave
  // the user exactly where they were, menu and all.
  function switchTo(id: string) {
    setError(null);
    if (id === wsId) {
      close();
      return;
    }
    requestLeave(() => {
      void navigate(`/w/${id}`);
      close();
    }, `switch to ${workspaces.find((w) => w.workspaceId === id)?.name ?? "another workspace"}`);
  }

  async function submitCreate() {
    const name = newName.trim();
    setCreating(false);
    setNewName("");
    if (!name) return;
    const tempId = `temp-${crypto.randomUUID()}`;
    try {
      const { workspaceId } = await createM.mutateAsync({ name, tempId });
      // BUG-54: creating switches INTO the new workspace, so it leaves the note screen
      // exactly as switchTo does. The create has already succeeded — declining the leave
      // keeps the new workspace in the list and leaves the user on their recording.
      requestLeave(() => {
        void navigate(`/w/${workspaceId}`);
        close();
      }, `switch to ${name}`);
    } catch {
      // rolled back in the mutation's onError; surface a generic error inline
      setError("Couldn't create the workspace. Try again.");
    }
  }

  function submitRename(id: string) {
    const name = renameVal.trim();
    setRenamingId(null);
    if (name) renameM.mutate({ workspaceId: id, name });
  }

  function attemptDelete(id: string) {
    setError(null);
    const wasActive = id === wsId;
    deleteM.mutate(
      { workspaceId: id },
      {
        // Deleting the workspace you're viewing would strand you on a now-dead
        // route — fall back to the default workspace.
        onSuccess: () => {
          if (wasActive) void navigate(`/w/${DEFAULT_WORKSPACE_ID}`);
          close();
        },
        onError: (e) =>
          setError(
            e instanceof WorkspaceNotEmptyError
              ? "Workspace is not empty — move or delete its notes first."
              : "Couldn't delete the workspace. Try again.",
          ),
      },
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="workspace-switcher-trigger"
      >
        <span className={styles.triggerName}>{activeName}</span>
        <span className={styles.chevron} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={styles.popover} role="menu" data-testid="workspace-switcher-menu">
          {workspaces.map((w) => {
            const isActive = w.workspaceId === wsId;
            return (
              <div key={w.workspaceId} className={styles.row} data-active={isActive || undefined}>
                <span className={styles.check} aria-hidden="true">{isActive ? "✓" : ""}</span>
                {renamingId === w.workspaceId ? (
                  // autoFocus is intentional: the rename input appears in direct
                  // response to the user choosing Rename, so focusing it is expected.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  <input autoFocus
                    className={styles.editInput}
                    value={renameVal}
                    aria-label="Workspace name"
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename(w.workspaceId);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => submitRename(w.workspaceId)}
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.name}
                    onClick={() => switchTo(w.workspaceId)}
                    data-testid={`workspace-option-${w.workspaceId}`}
                  >
                    {w.name}
                    {w.isDefault && <span className={styles.defaultTag}> · default</span>}
                  </button>
                )}
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={`Rename ${w.name}`}
                    onClick={() => { setRenamingId(w.workspaceId); setRenameVal(w.name); }}
                  >✎</button>
                  {!w.isDefault && (
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={`Delete ${w.name}`}
                      onClick={() => attemptDelete(w.workspaceId)}
                    >🗑</button>
                  )}
                </span>
              </div>
            );
          })}

          {error && (
            <div role="alert" className={styles.error}>{error}</div>
          )}

          <div className={styles.createRow}>
            {creating ? (
              // autoFocus is intentional: the create-workspace input appears in
              // direct response to the user choosing New, so focusing it is expected.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              <input autoFocus
                className={styles.editInput}
                placeholder="Workspace name…"
                aria-label="New workspace name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitCreate();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                onBlur={() => void submitCreate()}
              />
            ) : (
              <button
                type="button"
                className={styles.createBtn}
                onClick={() => setCreating(true)}
                data-testid="workspace-create"
              >+ New workspace</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
