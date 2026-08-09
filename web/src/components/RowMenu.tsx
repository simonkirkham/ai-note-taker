import { useEffect, useRef, useState } from "react";
import styles from "./RowMenu.module.css";

export type RowMenuAction = {
  label: string;
  run: () => void;
  disabled?: boolean;
};

// A per-row overflow menu. `open` is owned by the caller so a list can guarantee only one row's
// menu is open at a time. Presentational — it knows nothing about what the actions do.
//
// Unavailable actions use aria-disabled, NOT the `disabled` attribute: a disabled button cannot
// take focus, so when the FIRST action is unavailable (every action is, while a save is in
// flight) focus never entered the menu, the arrow keys did nothing, and Escape — handled on the
// popup — never fired, leaving the menu stuck open with no keyboard way out.
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

  // Moving focus into the menu is what makes the arrow keys and Escape reachable at all —
  // they are handled on the popup, which is only in the tree while open.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  // Skip over unavailable actions rather than parking on one: an aria-disabled item still takes
  // focus, so without this the roving index would sit on an action that does nothing.
  function step(from: number, direction: 1 | -1) {
    const n = actions.length;
    for (let i = 1; i <= n; i++) {
      const next = (((from + direction * i) % n) + n) % n;
      if (!actions[next].disabled) return next;
    }
    return from;
  }

  const firstEnabled = actions.findIndex((a) => !a.disabled);

  function openAt(index: number) {
    setActive(index === -1 ? 0 : index);
    onOpenChange(true);
  }

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
        aria-controls={open ? `${triggerId}-row-menu` : undefined}
        onClick={() => (open ? close(false) : openAt(firstEnabled))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            openAt(firstEnabled);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openAt(step(0, -1));
          } else if (e.key === "Escape" && open) {
            // Also handled on the popup, but focus may still be on the trigger when every
            // action is unavailable — without this the menu would be unclosable by keyboard.
            e.preventDefault();
            close(false);
          }
        }}
      >
        <EllipsisIcon />
      </button>
      {open && (
        <div
          id={`${triggerId}-row-menu`}
          className={styles.rowMenuPopup}
          role="menu"
          aria-label={label}
          // Keydown is handled on the container so every item shares one roving handler; that
          // makes the container interactive, so it must be focusable (-1: programmatic only —
          // focus belongs on the active item, never on the menu box itself).
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close(true);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => step(i, 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => step(i, -1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(step(actions.length - 1, 1));
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(step(0, -1));
            } else if (e.key === "Tab") {
              // Hand focus back to the trigger BEFORE unmounting the item, so the browser
              // resolves Tab from a live element instead of a detached one.
              close(true);
            }
          }}
        >
          {actions.map((action, i) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              aria-disabled={action.disabled || undefined}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={() => {
                if (action.disabled) return;
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
