import { useEffect, useRef, useState } from "react";

import styles from "./ShortcutsPanel.module.css";

const SHORTCUTS = [
  { keys: "## + Space", description: "H2 heading (agenda topic)" },
  { keys: "### + Space", description: "H3 heading (sub-topic)" },
  { keys: "**text**", description: "Bold" },
  { keys: "Ctrl+B", description: "Toggle bold" },
  { keys: "- + Space", description: "Bullet list" },
  { keys: "✓ button", description: "Mark heading as discussed" },
  { keys: "/ai …", description: "AI carries out the instruction on Generate" },
];

export default function ShortcutsPanel() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  return (
    <div className={styles.shortcutsPanel} ref={panelRef}>
      <button
        className={styles.shortcutsToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="shortcuts-table"
        aria-label="Toggle keyboard shortcuts"
        data-testid="shortcuts-toggle"
        tabIndex={-1}
      >
        ?
      </button>
      {open && (
        <table id="shortcuts-table" className={styles.shortcutsTable} data-testid="shortcuts-table">
          <tbody>
            {SHORTCUTS.map(({ keys, description }) => (
              <tr key={keys}>
                <td><kbd>{keys}</kbd></td>
                <td>{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
