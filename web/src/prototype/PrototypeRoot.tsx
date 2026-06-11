// PROTOTYPE — throwaway (Phase 23-E switcher). Renders the three switcher variants
// side by side over shared mock workspace state so the placement + the
// create/rename/delete interactions can be compared in the browser.
import { useState, type ReactNode } from "react";
import { useMockWorkspaces } from "./useMockWorkspaces";
import { WorkspaceCrudList } from "./WorkspaceCrudList";

type Store = ReturnType<typeof useMockWorkspaces>;

function Popover({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "absolute", zIndex: 10, marginTop: 4, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", padding: 6 }}>
      {children}
    </div>
  );
}

// Mock app chrome so each variant's placement is visible in context.
function Shell({ header, sidebarTop, sidebarSection, active }: { header?: ReactNode; sidebarTop?: ReactNode; sidebarSection?: ReactNode; active: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      {header && <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: "1px solid #e5e7eb", background: "#fafafa", fontWeight: 600 }}>{header}</div>}
      <div style={{ display: "flex", height: 280 }}>
        <div style={{ width: 240, borderRight: "1px solid #e5e7eb", padding: 8, position: "relative", background: "#fcfcfd" }}>
          {sidebarTop}
          {sidebarSection}
          <div style={{ marginTop: 12, color: "#9ca3af", fontSize: 11, letterSpacing: ".06em", padding: "0 8px" }}>FOLDERS</div>
          <div style={{ padding: "4px 8px", color: "#374151" }}>People</div>
          <div style={{ padding: "4px 8px", color: "#374151" }}>Projects</div>
        </div>
        <div style={{ flex: 1, padding: 16, color: "#6b7280" }}>
          <div style={{ fontSize: 13, color: "#9ca3af" }}>main area</div>
          <h3 style={{ margin: "6px 0", color: "#111" }}>Notes — {active}</h3>
          <div style={{ fontSize: 13 }}>(cards for the active workspace appear here)</div>
        </div>
      </div>
    </div>
  );
}

// Variant A — dropdown button at the top of the sidebar.
function VariantDropdown({ store }: { store: Store }) {
  const [open, setOpen] = useState(false);
  return (
    <Shell
      active={store.active.name}
      sidebarTop={
        <div style={{ position: "relative", marginBottom: 8 }}>
          <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: "pointer", font: "inherit", fontWeight: 600 }}>
            <span>{store.active.name}</span>
            <span style={{ color: "#9ca3af" }}>▾</span>
          </button>
          {open && <Popover><WorkspaceCrudList store={store} onPicked={() => setOpen(false)} /></Popover>}
        </div>
      }
    />
  );
}

// Variant B — always-visible "Workspaces" section in the sidebar.
function VariantSection({ store }: { store: Store }) {
  return (
    <Shell
      active={store.active.name}
      sidebarSection={
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "#9ca3af", fontSize: 11, letterSpacing: ".06em", padding: "0 8px 4px" }}>WORKSPACES</div>
          <WorkspaceCrudList store={store} />
        </div>
      }
    />
  );
}

// Variant C — pill in the top header bar.
function VariantHeaderPill({ store }: { store: Store }) {
  const [open, setOpen] = useState(false);
  return (
    <Shell
      active={store.active.name}
      header={
        <>
          <span>NoteTaker</span>
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: 999, background: "#fff", cursor: "pointer", font: "inherit", fontWeight: 600 }}>
              {store.active.name} <span style={{ color: "#9ca3af" }}>▾</span>
            </button>
            {open && <Popover><WorkspaceCrudList store={store} onPicked={() => setOpen(false)} /></Popover>}
          </div>
        </>
      }
    />
  );
}

const variants = [
  { key: "A", title: "Sidebar dropdown (top)", note: "Compact — active workspace is a button at the top of the sidebar; the list opens on click.", Comp: VariantDropdown },
  { key: "B", title: "Sidebar section (list)", note: "Always visible — every workspace is a row; one click to switch.", Comp: VariantSection },
  { key: "C", title: "Header pill dropdown", note: "Workspace context lives in the top header instead of the sidebar.", Comp: VariantHeaderPill },
];

export function PrototypeRoot() {
  const store = useMockWorkspaces();
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22 }}>Workspace switcher — prototype (23-E)</h1>
      <p style={{ color: "#6b7280" }}>
        All three share the same mock state. Try: <b>switch</b> (click a name), <b>create</b> (+ New workspace),
        <b> rename</b> (✎), <b>delete</b> (🗑). “Work” has notes → delete shows the not-empty error; “Clients” is empty → deletes. “Personal” is the default (no delete).
      </p>
      <button onClick={store.reset} style={{ marginBottom: 16, padding: "6px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
        Reset mock data
      </button>
      {variants.map(({ key, title, note, Comp }) => (
        <section key={key} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16 }}>{key}. {title}</h2>
          <p style={{ color: "#6b7280", marginTop: 0, fontSize: 14 }}>{note}</p>
          <Comp store={store} />
        </section>
      ))}
    </div>
  );
}
