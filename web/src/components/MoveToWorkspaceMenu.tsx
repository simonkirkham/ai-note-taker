import { useEffect, useRef, useState } from "react";
import styles from "./MoveToWorkspaceMenu.module.css";

// Presentational: the parent supplies the candidate workspaces (the caller's
// workspaces minus the current one) and the move handler. The handler drives the
// optimistic card removal, so the card vanishes from the current view on click.
export default function MoveToWorkspaceMenu({
  title,
  workspaces,
  onMove,
}: {
  title: string;
  workspaces: { workspaceId: string; name: string }[];
  onMove: (workspaceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (workspaces.length === 0) return null;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move "${title || "Untitled"}" to another workspace`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        Move
      </button>
      {open && (
        <div className={styles.menu} role="menu" data-testid="move-workspace-menu">
          {workspaces.map((w) => (
            <button
              key={w.workspaceId}
              type="button"
              role="menuitem"
              className={styles.item}
              data-testid={`move-workspace-option-${w.workspaceId}`}
              onClick={(e) => { e.stopPropagation(); onMove(w.workspaceId); setOpen(false); }}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
