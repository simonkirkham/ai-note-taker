// Prototype only — throwaway harness for Phase 51-A. Not wired to any backend.
//
// Scope (corrected 2026-08-09): the TOP-LEVEL open-note bar and how it behaves
// across Home. The note's own tab strip is not changing.
import clsx from "clsx";
import { useEffect, useState } from "react";
import { DIRECTIONS, NOTES, type DirectionId, type ViewId } from "./data";
import NoteScreen from "./NoteScreen";
import s from "./prototype.module.css";

type Seam = "line" | "none" | "merge-surface" | "merge-bg";

function stored<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

const NAV: { id: ViewId; label: string }[] = [
  { id: "list", label: "My notes" },
  { id: "folder", label: "Clients" },
  { id: "search", label: "Search" },
];

export default function PrototypeRoot() {
  const [direction, setDirection] = useState<DirectionId>(() => stored("proto51-direction", "a" as DirectionId));
  const [seam, setSeam] = useState<Seam>(() => stored("proto51-seam", "merge-surface" as Seam));
  const [openIds, setOpenIds] = useState<string[]>(() => stored("proto51-open", ["n1", "n2", "n3"]));
  const [view, setView] = useState<ViewId>("list");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem("proto51-direction", JSON.stringify(direction)); }, [direction]);
  useEffect(() => { localStorage.setItem("proto51-seam", JSON.stringify(seam)); }, [seam]);
  useEffect(() => { localStorage.setItem("proto51-open", JSON.stringify(openIds)); }, [openIds]);

  const onNote = view === "note" && activeId !== null;
  const dir = DIRECTIONS.find((d) => d.id === direction)!;

  // The whole question in one expression: when does the bar exist?
  //   today → only on a note screen (it vanishes on Home)
  //   a / b → always
  //   c     → never; open notes live in the sidebar instead
  const showBar = direction === "c" ? false : direction === "today" ? onNote : true;

  function openNote(id: string) {
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setActiveId(id);
    setView("note");
  }

  function closeNote(id: string) {
    setOpenIds((ids) => ids.filter((x) => x !== id));
    if (recordingId === id) setRecordingId(null);
    if (activeId === id) {
      const rest = openIds.filter((x) => x !== id);
      if (rest.length > 0) setActiveId(rest[0]);
      else { setActiveId(null); setView("list"); }
    }
  }

  function goto(v: ViewId) {
    setView(v);
    setActiveId(null);
  }

  const titleOf = (id: string) => NOTES.find((n) => n.id === id)?.title ?? "Untitled";

  const onCls = seam === "merge-bg" ? s.tabOnBg : s.tabOn;

  const bar = !showBar ? null : (
    <div className={clsx(s.bar, seam === "line" && s.barLine, seam === "merge-surface" && s.barMerged, seam === "merge-bg" && s.barMergedBg)}>
      {direction === "a" && (
        <div
          className={clsx(s.tab, s.tabHome, s.tabSticky, !onNote && onCls)}
          onClick={() => goto("list")}
        >
          <span aria-hidden="true">🏠</span>
          <span className={s.tabLabel}>My notes</span>
        </div>
      )}
      {openIds.map((id) => (
        <div
          key={id}
          className={clsx(s.tab, onNote && id === activeId && onCls)}
          onClick={() => openNote(id)}
        >
          {recordingId === id && <span className={s.recDot} />}
          <span className={s.tabLabel}>{titleOf(id)}</span>
          <span className={s.tabClose} onClick={(e) => { e.stopPropagation(); closeNote(id); }}>×</span>
        </div>
      ))}
    </div>
  );

  const listScreen = (
    <div className={s.screen}>
      <h1 className={s.listHeading}>
        {view === "folder" ? "Clients" : view === "search" ? "Search results" : "My notes"}
      </h1>
      {NOTES.slice(0, 6).map((n) => (
        <div
          key={n.id}
          className={clsx(s.card, openIds.includes(n.id) && s.cardOpen)}
          onClick={() => openNote(n.id)}
        >
          <div className={s.cardRow}>
            <span>{n.title}</span>
            {openIds.includes(n.id) && <span className={s.openFlag}>Open</span>}
          </div>
          <div className={s.cardMeta}>{n.meta}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className={s.harness}>
      <p className={s.harnessTitle}>Phase 51-A · open-note bar · prototype</p>

      <div className={s.controls}>
        <Group label="Direction">
          {DIRECTIONS.map((d) => (
            <Seg key={d.id} on={direction === d.id} onClick={() => setDirection(d.id)}>{d.name}</Seg>
          ))}
        </Group>
        <Group label="Line under the bar">
          <Seg on={seam === "line"} onClick={() => setSeam("line")}>Line (today)</Seg>
          <Seg on={seam === "none"} onClick={() => setSeam("none")}>No line</Seg>
          <Seg on={seam === "merge-surface"} onClick={() => setSeam("merge-surface")}>Merge · repaint page</Seg>
          <Seg on={seam === "merge-bg"} onClick={() => setSeam("merge-bg")}>Merge · repaint bar</Seg>
        </Group>
        <Group label="Notes open">
          <Seg on={openIds.length === 1} onClick={() => setOpenIds(["n1"])}>1</Seg>
          <Seg on={openIds.length === 3} onClick={() => setOpenIds(["n1", "n2", "n3"])}>3</Seg>
          <Seg on={openIds.length === 8} onClick={() => setOpenIds(NOTES.map((n) => n.id))}>8</Seg>
          <Seg on={openIds.length === 0} onClick={() => { setOpenIds([]); goto("list"); }}>0</Seg>
        </Group>
        <Group label="51-C">
          <Seg
            on={recordingId !== null}
            onClick={() => setRecordingId((r) => (r ? null : openIds.find((x) => x !== activeId) ?? openIds[0] ?? null))}
          >
            {recordingId ? `Recording: ${titleOf(recordingId)}` : "A note is recording"}
          </Seg>
        </Group>
      </div>

      <p className={s.hint}>
        ↓ Click “My notes” in the sidebar, then a note, then My notes again. That round trip is the thing being fixed.
      </p>
      <p className={s.pitch}>{dir.pitch}</p>

      <div className={s.viewport}>
        <div className={s.frame}>
          <div className={s.sidebar}>
            <div className={s.sidebarBrand}>Note Taker</div>
            {NAV.map((n) => (
              <div
                key={n.id}
                className={clsx(s.sidebarItem, !onNote && view === n.id && s.sidebarItemOn)}
                onClick={() => goto(n.id)}
              >
                {n.label}
              </div>
            ))}

            {direction === "c" && (
              <>
                <div className={s.railHeading}>
                  <span>Open notes</span>
                  {openIds.length > 0 && <span className={s.railCount}>{openIds.length}</span>}
                </div>
                {openIds.length === 0 && <div className={s.railEmpty}>Nothing open. Notes you open appear here.</div>}
                {openIds.map((id) => (
                  <div
                    key={id}
                    className={clsx(s.railItem, onNote && id === activeId && s.railItemOn)}
                    onClick={() => openNote(id)}
                  >
                    {recordingId === id && <span className={s.recDot} />}
                    <span className={s.railLabel}>{titleOf(id)}</span>
                    <span className={s.tabClose} onClick={(e) => { e.stopPropagation(); closeNote(id); }}>×</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className={s.appMain}>
            {bar}
            <div className={clsx(s.appMain, seam === "merge-surface" && showBar && s.contentMerged)}>
              {onNote ? <NoteScreen noteId={activeId} /> : listScreen}
            </div>
          </div>
        </div>
      </div>

      <p className={s.note}>
        Throwaway prototype — no backend, no specs, never merged. The note’s own Quick notes / Transcript / Final
        notes strip is deliberately unchanged in every direction. Cards you already have open are flagged
        <strong> Open</strong> in the list, which is a small extra idea worth judging separately from the bar itself.
      </p>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={s.group}>
      <span className={s.groupLabel}>{label}</span>
      <div className={s.segRow}>{children}</div>
    </div>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={clsx(s.seg, on && s.segOn)} onClick={onClick}>
      {children}
    </button>
  );
}
