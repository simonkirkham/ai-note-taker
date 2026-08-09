// PROTOTYPE — 50-B "Move to Today / Move to Later". Throwaway, prototype branch only.
// Reuses the real TodoSection.module.css so rows/line render exactly like the live list.
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  TrashIcon,
  GripVerticalIcon,
  SendToTopIcon,
  SendToBottomIcon,
} from "../components/icons";
import styles from "../components/TodoSection.module.css";
import p from "./prototype.module.css";

type Item = { id: string; description: string; noteTitle?: string };

const SEED: Item[] = [
  { id: "1", description: "Draft the Q3 board deck", noteTitle: "Board prep" },
  { id: "2", description: "Chase the Acme invoice" },
  { id: "3", description: "Reply to Priya about the migration window", noteTitle: "Platform sync" },
  { id: "4", description: "Book the offsite venue" },
  { id: "5", description: "Renew the notetaker.dev domain" },
  { id: "6", description: "Write up the retro actions", noteTitle: "Sprint 41 retro" },
];

type Variant = "icon" | "text" | "reuse" | "menu";

const VARIANTS: { key: Variant; name: string; blurb: string }[] = [
  { key: "icon", name: "A — Fourth icon", blurb: "One more icon-btn in the cluster; glyph flips by side." },
  { key: "text", name: "B — Text button", blurb: "Names the destination outright. Costs row width." },
  { key: "reuse", name: "C — Line-aware arrows", blurb: "No new control. Existing ↑/↓ cross the line instead." },
  { key: "menu", name: "D — Overflow menu", blurb: "Row drops to description + delete; actions behind ⋯." },
];

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function usePersisted<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }, [key, v]);
  return [v, setV] as const;
}

// Line sits immediately ABOVE its anchor; null anchor = below everything (all Today).
// Same model as the shipped 50-A implementation, so index maths carries over.
export function PrototypeRoot() {
  const [variant, setVariant] = usePersisted<Variant>("proto50b.variant", "icon");
  const [items, setItems] = usePersisted<Item[]>("proto50b.items", SEED);
  const [anchorId, setAnchorId] = usePersisted<string | null>("proto50b.anchor", "4");
  const [flash, setFlash] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const anchorIndex = anchorId ? items.findIndex((i) => i.id === anchorId) : -1;
  const splitAt = anchorIndex >= 0 ? anchorIndex : items.length;
  const todayItems = items.slice(0, splitAt);
  const laterItems = items.slice(splitAt);

  function announce(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 1800);
  }

  function reset() {
    setItems(SEED);
    setAnchorId("4");
    announce("Reset");
  }

  // The whole point of the slice: bottom-of-Today when promoting, top-of-Later when demoting.
  function moveAcross(item: Item) {
    const from = items.findIndex((i) => i.id === item.id);
    const goingToLater = from < splitAt;

    if (goingToLater) {
      const next = arrayMove(items, from, splitAt - 1);
      setItems(next);
      setAnchorId(item.id);
      announce(`"${item.description}" → first in Later`);
      return;
    }

    // Promoting the anchor itself would drag the line with it, so re-anchor to the
    // next Later item first (null once nothing is left below).
    if (item.id === anchorId) {
      setAnchorId(laterItems[1]?.id ?? null);
    }
    const next = arrayMove(items, from, splitAt);
    setItems(next);
    announce(`"${item.description}" → last in Today`);
  }

  function sendTo(item: Item, where: "top" | "bottom") {
    const from = items.findIndex((i) => i.id === item.id);
    if (variant === "reuse") {
      // Variant C: the arrows are line-aware — they act within your group, and cross
      // the line when you are already at that end of it.
      const inToday = from < splitAt;
      if (where === "top") {
        if (inToday) {
          setItems(arrayMove(items, from, 0));
          announce("Top of Today");
        } else {
          moveAcross(item);
        }
      } else if (inToday) {
        moveAcross(item);
      } else {
        setItems(arrayMove(items, from, items.length - 1));
        announce("Bottom of Later");
      }
      return;
    }
    setItems(arrayMove(items, from, where === "top" ? 0 : items.length - 1));
    announce(where === "top" ? "Sent to top" : "Sent to bottom");
  }

  function renderRow(item: Item, groupIsToday: boolean) {
    const idx = items.findIndex((i) => i.id === item.id);
    const crossLabel = groupIsToday ? "Move to Later" : "Move to Today";
    return (
      <li key={item.id} className={styles.todoItem}>
        <span className={styles.todoDragHandle} aria-hidden="true">
          <GripVerticalIcon />
        </span>
        <input type="checkbox" className={styles.todoCheckbox} readOnly checked={false} />
        <div className={styles.todoItemContent}>
          <span className={styles.todoDescription}>{item.description}</span>
          {item.noteTitle && <span className={styles.todoNoteTitle}>{item.noteTitle}</span>}
        </div>

        {variant === "text" && (
          <button
            type="button"
            className={p.crossTextBtn}
            onClick={() => moveAcross(item)}
          >
            {groupIsToday ? "Later ↓" : "↑ Today"}
          </button>
        )}

        {variant !== "menu" && (
          <div className={styles.todoSendButtons}>
            <button
              type="button"
              className="icon-btn"
              title={variant === "reuse" && !groupIsToday ? "Move to Today" : "Send to top"}
              aria-label={`Send "${item.description}" to top`}
              disabled={variant !== "reuse" && idx === 0}
              onClick={() => sendTo(item, "top")}
            >
              <SendToTopIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={variant === "reuse" && groupIsToday ? "Move to Later" : "Send to bottom"}
              aria-label={`Send "${item.description}" to bottom`}
              disabled={variant !== "reuse" && idx === items.length - 1}
              onClick={() => sendTo(item, "bottom")}
            >
              <SendToBottomIcon />
            </button>
            {variant === "icon" && (
              <button
                type="button"
                className="icon-btn"
                title={crossLabel}
                aria-label={`${crossLabel}: "${item.description}"`}
                onClick={() => moveAcross(item)}
              >
                <CrossLineIcon down={groupIsToday} />
              </button>
            )}
          </div>
        )}

        {variant === "menu" && (
          <div className={p.menuWrap}>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Actions for "${item.description}"`}
              aria-expanded={openMenu === item.id}
              onClick={() => setOpenMenu(openMenu === item.id ? null : item.id)}
            >
              <span className={p.ellipsis}>⋯</span>
            </button>
            {openMenu === item.id && (
              <div className={p.menu} role="menu">
                <button type="button" role="menuitem" onClick={() => { moveAcross(item); setOpenMenu(null); }}>
                  {crossLabel}
                </button>
                <button type="button" role="menuitem" onClick={() => { sendTo(item, "top"); setOpenMenu(null); }}>
                  Send to top
                </button>
                <button type="button" role="menuitem" onClick={() => { sendTo(item, "bottom"); setOpenMenu(null); }}>
                  Send to bottom
                </button>
              </div>
            )}
          </div>
        )}

        <button className="icon-btn icon-btn--danger" aria-label={`Delete "${item.description}"`}>
          <TrashIcon />
        </button>
      </li>
    );
  }

  return (
    <div className={p.page}>
      <header className={p.header}>
        <h1 className={p.title}>50-B prototype — move a to-do across the Today line</h1>
        <p className={p.sub}>
          Click the move control on any row. Promoting lands the item <strong>last in Today</strong>;
          demoting lands it <strong>first in Later</strong>. Everything persists in localStorage.
        </p>
      </header>

      <nav className={p.tabs}>
        {VARIANTS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={clsx(p.tab, variant === v.key && p.tabActive)}
            onClick={() => { setVariant(v.key); setOpenMenu(null); }}
          >
            {v.name}
          </button>
        ))}
        <button type="button" className={p.reset} onClick={reset}>Reset list</button>
      </nav>

      <p className={p.blurb}>{VARIANTS.find((v) => v.key === variant)?.blurb}</p>

      <div className={p.panel}>
        <section className={styles.todoSection}>
          <h2 className={styles.todoHeading}>To do</h2>

          <div className={p.groupLabel}>Today</div>
          {todayItems.length === 0 ? (
            <p className={styles.todoGroupEmpty}>Nothing in today yet.</p>
          ) : (
            <ul className={styles.todoList}>{todayItems.map((i) => renderRow(i, true))}</ul>
          )}

          <div className={styles.todayLine}>
            <span className={styles.todayLineHandle} aria-hidden="true">
              <GripVerticalIcon />
            </span>
            <span className={styles.todayLineLabel}>End of today</span>
          </div>

          {laterItems.length > 0 && (
            <>
              <div className={p.groupLabel}>Later</div>
              <ul className={styles.todoList}>{laterItems.map((i) => renderRow(i, false))}</ul>
            </>
          )}
        </section>
      </div>

      <div className={p.flashSlot}>{flash && <span className={p.flash}>{flash}</span>}</div>
    </div>
  );
}

function CrossLineIcon({ down }: { down: boolean }) {
  // Arrow crossing a horizontal rule — down = leaving Today, up = entering Today.
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h16" strokeDasharray="3 2" />
      {down ? <path d="M12 4v10m-4-4l4 4 4-4" /> : <path d="M12 20V10m-4 4l4-4 4 4" />}
    </svg>
  );
}

export default PrototypeRoot;
