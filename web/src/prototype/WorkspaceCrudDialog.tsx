// PROTOTYPE — throwaway. Variant-A CRUD "Style 2": modal create/rename, confirm-
// before-delete, and a toast for the not-empty error (contrast with the inline style).
import { useState, type ReactNode } from "react";
import type { useMockWorkspaces } from "./useMockWorkspaces";

type Store = ReturnType<typeof useMockWorkspaces>;
type Dialog =
  | { kind: "create" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "delete"; id: string; name: string }
  | null;

function Modal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.35)" }}>
      <div style={{ background: "#fff", borderRadius: 10, padding: 18, width: 320, boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { padding: "7px 14px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", font: "inherit" };
const primary: React.CSSProperties = { ...btn, background: "#4f46e5", color: "#fff", border: "1px solid #4f46e5" };
const danger: React.CSSProperties = { ...btn, background: "#dc2626", color: "#fff", border: "1px solid #dc2626" };

export function WorkspaceCrudDialog({ store, onPicked }: { store: Store; onPicked?: () => void }) {
  const { workspaces, activeId, switchTo, create, rename, remove } = store;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [val, setVal] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div style={{ minWidth: 220 }}>
      {workspaces.map((w) => (
        <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6, background: w.id === activeId ? "#eef2ff" : "transparent", fontWeight: w.id === activeId ? 600 : 400 }}>
          <span style={{ width: 14, color: "#4f46e5" }}>{w.id === activeId ? "✓" : ""}</span>
          <button onClick={() => { switchTo(w.id); onPicked?.(); }} style={{ flex: 1, textAlign: "left", background: "none", border: "none", font: "inherit", cursor: "pointer", color: "#111" }}>
            {w.name}{w.isDefault && <span style={{ color: "#9ca3af", fontWeight: 400 }}> · default</span>}
          </button>
          <button title="Rename" onClick={() => { setVal(w.name); setDialog({ kind: "rename", id: w.id, name: w.name }); }} style={icon}>✎</button>
          {!w.isDefault && <button title="Delete" onClick={() => setDialog({ kind: "delete", id: w.id, name: w.name })} style={icon}>🗑</button>}
        </div>
      ))}

      <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 4, paddingTop: 4 }}>
        <button onClick={() => { setVal(""); setDialog({ kind: "create" }); }} style={{ ...icon, width: "100%", textAlign: "left", padding: "6px 8px", color: "#4f46e5" }}>
          + New workspace
        </button>
      </div>

      {dialog?.kind === "create" && (
        <Modal title="New workspace">
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="Workspace name…" style={{ width: "100%", padding: 8, font: "inherit", boxSizing: "border-box", marginBottom: 12 }} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button style={btn} onClick={() => setDialog(null)}>Cancel</button>
            <button style={primary} onClick={() => { if (val.trim()) { create(val.trim()); onPicked?.(); } setDialog(null); }}>Create</button>
          </div>
        </Modal>
      )}

      {dialog?.kind === "rename" && (
        <Modal title="Rename workspace">
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} style={{ width: "100%", padding: 8, font: "inherit", boxSizing: "border-box", marginBottom: 12 }} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button style={btn} onClick={() => setDialog(null)}>Cancel</button>
            <button style={primary} onClick={() => { if (val.trim()) rename(dialog.id, val.trim()); setDialog(null); }}>Save</button>
          </div>
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal title={`Delete “${dialog.name}”?`}>
          <p style={{ color: "#6b7280", fontSize: 14, marginTop: 0 }}>This can't be undone.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button style={btn} onClick={() => setDialog(null)}>Cancel</button>
            <button style={danger} onClick={() => { const err = remove(dialog.id); setDialog(null); if (err) flashToast(err); }}>Delete</button>
          </div>
        </Modal>
      )}

      {toast && (
        <div role="alert" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 60, background: "#1f2937", color: "#fff", padding: "10px 16px", borderRadius: 8, fontSize: 14, boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

const icon: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6b7280", padding: 2 };
