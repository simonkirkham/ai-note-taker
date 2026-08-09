import { useEffect, useRef, useState } from "react";
import styles from "./RowMenu.module.css";

export type RowMenuAction = {
  label: string;
  run: () => void;
  disabled?: boolean;
};

// A per-row overflow menu. `open` is owned by the caller so a list can guarantee only one
// row's menu is open at a time. Presentational — it knows nothing about to-dos.
export default function RowMenu({
  label,
  triggerId,
  open,
  onOpenChange,
  actions,
}: {
  label: string;
  triggerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: RowMenuAction[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onOpenChange]);

  // Opening always starts at the first action; the focus move is what makes the arrow keys
  // and Enter reach the menu at all, since the trigger keeps focus otherwise.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  function close(refocusTrigger: boolean) {
    onOpenChange(false);
    setActive(0);
    if (refocusTrigger) triggerRef.current?.focus();
  }

  return (
    <div className={styles.rowMenu} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        data-menu-trigger={triggerId}
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : onOpenChange(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive(0);
            onOpenChange(true);
          }
        }}
      >
        <EllipsisIcon />
      </button>
      {open && (
        <div
          className={styles.rowMenuPopup}
          role="menu"
          aria-label={label}
          // Keydown is handled on the container so every item shares one roving handler;
          // that makes the container interactive, so it must be focusable (-1: programmatic
          // only — focus belongs on the active item, never on the menu box itself).
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close(true);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % actions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + actions.length) % actions.length);
            } else if (e.key === "Tab") {
              // Let focus move on naturally rather than trapping it in a row-level menu.
              close(false);
            }
          }}
        >
          {actions.map((action, i) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              disabled={action.disabled}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={() => {
                action.run();
                close(true);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}
