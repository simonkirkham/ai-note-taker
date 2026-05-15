import { useState } from "react";

const SHORTCUTS = [
  { keys: "## + Space", description: "H2 heading (agenda topic)" },
  { keys: "### + Space", description: "H3 heading (sub-topic)" },
  { keys: "**text**", description: "Bold" },
  { keys: "Ctrl+B", description: "Toggle bold" },
  { keys: "- + Space", description: "Bullet list" },
  { keys: "✓ button", description: "Mark heading as discussed" },
];

export default function ShortcutsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="shortcuts-panel">
      <button
        className="shortcuts-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle keyboard shortcuts"
        data-testid="shortcuts-toggle"
      >
        ?
      </button>
      {open && (
        <table className="shortcuts-table" data-testid="shortcuts-table">
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
