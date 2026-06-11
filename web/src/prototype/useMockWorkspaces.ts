// PROTOTYPE — throwaway. Mock workspace state shared across the switcher variants.
// localStorage-persisted; API calls would be fire-and-forget in the real thing.
import { useEffect, useState } from "react";

export type MockWorkspace = {
  id: string;
  name: string;
  isDefault: boolean;
  hasNotes: boolean; // demo only: drives the non-empty-delete error
};

const KEY = "proto23e-workspaces";
const ACTIVE_KEY = "proto23e-active";

const seed: MockWorkspace[] = [
  { id: "__default__", name: "Personal", isDefault: true, hasNotes: true },
  { id: "ws-work", name: "Work", isDefault: false, hasNotes: true },
  { id: "ws-clients", name: "Clients", isDefault: false, hasNotes: false },
];

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function useMockWorkspaces() {
  const [workspaces, setWorkspaces] = useState<MockWorkspace[]>(() => load(KEY, seed));
  const [activeId, setActiveId] = useState<string>(() => load(ACTIVE_KEY, "__default__"));

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(workspaces)); }, [workspaces]);
  useEffect(() => { localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeId)); }, [activeId]);

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  function create(name: string) {
    const id = `ws-${Math.random().toString(36).slice(2, 8)}`;
    setWorkspaces((ws) => [...ws, { id, name, isDefault: false, hasNotes: false }]);
    setActiveId(id); // create + switch into it (optimistic)
  }

  function rename(id: string, name: string) {
    setWorkspaces((ws) => ws.map((w) => (w.id === id ? { ...w, name } : w)));
  }

  // Returns an error message if the workspace can't be deleted, else null.
  function remove(id: string): string | null {
    const w = workspaces.find((x) => x.id === id);
    if (!w) return null;
    if (w.isDefault) return "The default workspace can't be deleted.";
    if (w.hasNotes) return "Workspace is not empty — move or delete its notes first.";
    setWorkspaces((ws) => ws.filter((x) => x.id !== id));
    if (activeId === id) setActiveId("__default__");
    return null;
  }

  function reset() {
    setWorkspaces(seed);
    setActiveId("__default__");
  }

  return { workspaces, active, activeId, switchTo: setActiveId, create, rename, remove, reset };
}
