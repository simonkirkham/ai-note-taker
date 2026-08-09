// Prototype only — throwaway harness for Phase 51-A. Not wired to any backend.
import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  DIRECTIONS,
  NOTES,
  STATES,
  type BarScope,
  type DirectionId,
  type StateId,
  type ViewId,
} from "./data";
import NoteScreen from "./NoteScreen";
import s from "./prototype.module.css";

function stored<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function PrototypeRoot() {
  const [direction, setDirection] = useState<DirectionId>(() => stored("proto51-direction", "a" as DirectionId));
  const [stateId, setStateId] = useState<StateId>(() => stored("proto51-state", "typed" as StateId));
  const [barScope, setBarScope] = useState<BarScope>(() => stored("proto51-scope", "note-only" as BarScope));
  const [openCount, setOpenCount] = useState<number>(() => stored("proto51-count", 3));
  const [view, setView] = useState<ViewId>("note");
  const [bgRecording, setBgRecording] = useState(false);
  const [activeId, setActiveId] = useState(NOTES[0].id);
  const [closed, setClosed] = useState<string[]>([]);

  useEffect(() => { localStorage.setItem("proto51-direction", JSON.stringify(direction)); }, [direction]);
  useEffect(() => { localStorage.setItem("proto51-state", JSON.stringify(stateId)); }, [stateId]);
  useEffect(() => { localStorage.setItem("proto51-scope", JSON.stringify(barScope)); }, [barScope]);
  useEffect(() => { localStorage.setItem("proto51-count", JSON.stringify(openCount)); }, [openCount]);

  const openIds = NOTES.slice(0, openCount).map((n) => n.id).filter((id) => !closed.includes(id));
  const bgRecordingId = bgRecording ? (openIds.find((id) => id !== activeId) ?? null) : null;
  const pitch = DIRECTIONS.find((d) => d.id === direction)!.pitch;

  useEffect(() => {
    if (!openIds.includes(activeId) && openIds.length > 0) setActiveId(openIds[0]);
  }, [openIds, activeId]);

  return (
    <div className={s.harness}>
      <p className={s.harnessTitle}>Phase 51-A · tabs redesign · prototype</p>

      <div className={s.controls}>
        <Group label="Direction">
          {DIRECTIONS.map((d) => (
            <Seg key={d.id} on={direction === d.id} onClick={() => setDirection(d.id)}>{d.name}</Seg>
          ))}
        </Group>
        <Group label="What this note holds">
          {STATES.map((st) => (
            <Seg key={st.id} on={stateId === st.id} onClick={() => setStateId(st.id)}>{st.label}</Seg>
          ))}
        </Group>
        <Group label="Screen">
          <Seg on={view === "note"} onClick={() => setView("note")}>Note</Seg>
          <Seg on={view === "list"} onClick={() => setView("list")}>Notes list</Seg>
        </Group>
        <Group label="Bar scope">
          <Seg on={barScope === "note-only"} onClick={() => setBarScope("note-only")}>Note only (today)</Seg>
          <Seg on={barScope === "always"} onClick={() => setBarScope("always")}>Always visible</Seg>
        </Group>
        <Group label="Notes open">
          {[1, 3, 8].map((n) => (
            <Seg key={n} on={openCount === n} onClick={() => { setOpenCount(n); setClosed([]); }}>{n}</Seg>
          ))}
        </Group>
        <Group label="51-C">
          <Seg on={bgRecording} onClick={() => setBgRecording((v) => !v)}>
            {bgRecording ? "Background note IS recording" : "Background note recording"}
          </Seg>
        </Group>
      </div>

      <p className={s.pitch}>{pitch}</p>

      <div className={s.viewport}>
        <div className={s.frame}>
          <div className={s.sidebar}>
            <div className={s.sidebarBrand}>Note Taker</div>
            <div className={clsx(s.sidebarItem, view === "list" && s.sidebarItemOn)}>My notes</div>
            <div className={s.sidebarItem}>To do</div>
            <div className={s.sidebarItem}>Meetings</div>
            <div className={s.sidebarItem}>Search</div>
          </div>
          <div className={s.appMain}>
            <NoteScreen
              direction={direction}
              stateId={stateId}
              barScope={barScope}
              view={view}
              openIds={openIds}
              activeId={activeId}
              bgRecordingId={bgRecordingId}
              notes={NOTES}
              onSelect={(id) => { setActiveId(id); setView("note"); }}
              onClose={(id) => setClosed((c) => [...c, id])}
              onGoList={() => setView("list")}
            />
          </div>
        </div>
      </div>

      <p className={s.note}>
        Throwaway prototype — no backend, no specs, never merged. Toggle “What this note holds” to see how each
        direction handles a tab whose content does not exist, and “Background note recording” for the 51-C case
        where the live note is not the one on screen.
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
