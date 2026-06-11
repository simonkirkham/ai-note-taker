// PROTOTYPE — throwaway (Phase 23-E switcher). Placement locked to Variant A
// (sidebar dropdown). This page compares two CRUD interaction styles within A:
// Style 1 (inline in the dropdown) vs Style 2 (modal dialogs + confirm + toast).
import { useState, type ReactNode } from "react";
import { useMockWorkspaces } from "./useMockWorkspaces";
import { WorkspaceCrudList } from "./WorkspaceCrudList";
import { WorkspaceCrudDialog } from "./WorkspaceCrudDialog";

type Store = ReturnType<typeof useMockWorkspaces>;

function Popover({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "absolute", zIndex: 10, marginTop: 4, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", padding: 6 }}>
      {children}
    </div>
  );
}

// Variant A chrome (sidebar dropdown), with the CRUD body injected as a render prop.
function VariantA({ store, body }: { store: Store; body: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      <div style={{ display: "flex", height: 280 }}>
        <div style={{ width: 240, borderRight: "1px solid #e5e7eb", padding: 8, position: "relative", background: "#fcfcfd" }}>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", font: "inherit", fontWeight: 600 }}>
              <span>{store.active.name}</span>
              <span style={{ color: "#9ca3af" }}>▾</span>
            </button>
            {open && <Popover>{body(() => setOpen(false))}</Popover>}
          </div>
          <div style={{ marginTop: 12, color: "#9ca3af", fontSize: 11, letterSpacing: ".06em", padding: "0 8px" }}>FOLDERS</div>
          <div style={{ padding: "4px 8px", color: "#374151" }}>People</div>
          <div style={{ padding: "4px 8px", color: "#374151" }}>Projects</div>
        </div>
        <div style={{ flex: 1, padding: 16, color: "#6b7280" }}>
          <div style={{ fontSize: 13, color: "#9ca3af" }}>main area</div>
          <h3 style={{ margin: "6px 0", color: "#111" }}>Notes — {store.active.name}</h3>
          <div style={{ fontSize: 13 }}>(cards for the active workspace appear here)</div>
        </div>
      </div>
    </div>
  );
}

export function PrototypeRoot() {
  const store = useMockWorkspaces();
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22 }}>Workspace switcher — 23-E (Variant A: sidebar dropdown)</h1>
      <p style={{ color: "#6b7280" }}>
        Click the workspace button (top-left of each card) to open the dropdown. Two CRUD styles to compare —
        same switch/create/rename/delete, different chrome. “Work” has notes → delete is blocked (not-empty);
        “Clients” is empty → deletes; “Personal” is the default (no delete). State is shared between the two.
      </p>
      <button onClick={store.reset} style={{ marginBottom: 20, padding: "6px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
        Reset mock data
      </button>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16 }}>Style 1 — Inline</h2>
        <p style={{ color: "#6b7280", marginTop: 0, fontSize: 14 }}>
          Create/rename happen inline inside the dropdown; delete is immediate; the not-empty error shows inline in the dropdown. Fewest clicks, no context switch.
        </p>
        <VariantA store={store} body={(close) => <WorkspaceCrudList store={store} onPicked={close} />} />
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16 }}>Style 2 — Dialogs</h2>
        <p style={{ color: "#6b7280", marginTop: 0, fontSize: 14 }}>
          Create/rename open a modal; delete asks for confirmation; the not-empty error is a toast. More deliberate, matches a typical settings UX, easier to add validation to.
        </p>
        <VariantA store={store} body={(close) => <WorkspaceCrudDialog store={store} onPicked={close} />} />
      </section>
    </div>
  );
}
