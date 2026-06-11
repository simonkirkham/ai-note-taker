// PROTOTYPE — throwaway. The shared interactive workspace list (switch / create /
// rename / delete + non-empty-delete error), reused by all three switcher variants.
import { useState } from "react";
import type { useMockWorkspaces } from "./useMockWorkspaces";

type Store = ReturnType<typeof useMockWorkspaces>;

export function WorkspaceCrudList({ store, onPicked }: { store: Store; onPicked?: () => void }) {
  const { workspaces, activeId, switchTo, create, rename, remove } = store;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submitCreate() {
    const n = newName.trim();
    if (n) create(n);
    setNewName("");
    setCreating(false);
    onPicked?.();
  }

  function submitRename(id: string) {
    const n = renameVal.trim();
    if (n) rename(id, n);
    setRenamingId(null);
  }

  function attemptDelete(id: string) {
    const err = remove(id);
    setError(err);
  }

  return (
    <div style={{ minWidth: 220 }}>
      {workspaces.map((w) => (
        <div
          key={w.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px",
            borderRadius: 6,
            background: w.id === activeId ? "#eef2ff" : "transparent",
            fontWeight: w.id === activeId ? 600 : 400,
          }}
          onMouseEnter={(e) => (e.currentTarget.dataset.hover = "1")}
        >
          <span style={{ width: 14, color: "#4f46e5" }}>{w.id === activeId ? "✓" : ""}</span>
          {renamingId === w.id ? (
            <input
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRename(w.id)}
              onBlur={() => submitRename(w.id)}
              style={{ flex: 1, font: "inherit" }}
            />
          ) : (
            <button
              onClick={() => { switchTo(w.id); setError(null); onPicked?.(); }}
              style={{ flex: 1, textAlign: "left", background: "none", border: "none", font: "inherit", cursor: "pointer", color: "#111" }}
            >
              {w.name}
              {w.isDefault && <span style={{ color: "#9ca3af", fontWeight: 400 }}> · default</span>}
            </button>
          )}
          <button title="Rename" onClick={() => { setRenamingId(w.id); setRenameVal(w.name); }} style={iconBtn}>✎</button>
          {!w.isDefault && (
            <button title="Delete" onClick={() => attemptDelete(w.id)} style={iconBtn}>🗑</button>
          )}
        </div>
      ))}

      {error && (
        <div role="alert" style={{ margin: "6px 8px", padding: "6px 8px", borderRadius: 6, background: "#fef2f2", color: "#b91c1c", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 4, paddingTop: 4 }}>
        {creating ? (
          <input
            autoFocus
            placeholder="Workspace name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
            onBlur={submitCreate}
            style={{ width: "100%", padding: "6px 8px", font: "inherit", boxSizing: "border-box" }}
          />
        ) : (
          <button onClick={() => setCreating(true)} style={{ ...iconBtn, width: "100%", textAlign: "left", padding: "6px 8px", color: "#4f46e5" }}>
            + New workspace
          </button>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  color: "#6b7280",
  padding: 2,
};
