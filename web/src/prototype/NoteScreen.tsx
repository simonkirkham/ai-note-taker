// Prototype only — throwaway. One component renders all three directions so they
// share the same fixtures and differ only where the design differs.
import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  FINAL_ACTIONS,
  FINAL_DECISIONS,
  FINAL_POINTS,
  QUICK_LINES,
  STATES,
  TRANSCRIPT_LINES,
  type BarScope,
  type DirectionId,
  type StateId,
  type ViewId,
} from "./data";
import s from "./prototype.module.css";

type Tab = "quick" | "transcript" | "final";

export default function NoteScreen({
  direction,
  stateId,
  barScope,
  view,
  openIds,
  activeId,
  bgRecordingId,
  notes,
  onSelect,
  onClose,
  onGoList,
}: {
  direction: DirectionId;
  stateId: StateId;
  barScope: BarScope;
  view: ViewId;
  openIds: string[];
  activeId: string;
  bgRecordingId: string | null;
  notes: { id: string; title: string }[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onGoList: () => void;
}) {
  const st = STATES.find((x) => x.id === stateId)!;
  const [tab, setTab] = useState<Tab>("quick");

  // Recording forces the transcript view, mirroring NoteView.tsx:474.
  useEffect(() => {
    if (st.recording) setTab("transcript");
  }, [st.recording]);

  // A hides what isn't there — never leave the user on a tab that just vanished.
  useEffect(() => {
    if (direction !== "a") return;
    if (tab === "transcript" && !st.hasTranscript) setTab("quick");
    if (tab === "final" && !st.hasFinal) setTab("quick");
  }, [direction, tab, st.hasTranscript, st.hasFinal]);

  const showBar = openIds.length > 0 && (view === "note" || barScope === "always");
  const titleOf = (id: string) => notes.find((n) => n.id === id)?.title ?? "Untitled";

  const bar = !showBar ? null : direction === "c" ? (
    <div className={s.barDocs}>
      {openIds.map((id) => (
        <div
          key={id}
          className={clsx(s.doc, view === "note" && id === activeId && s.docOn)}
          onClick={() => onSelect(id)}
        >
          {bgRecordingId === id && <span className={s.recDot} />}
          <span className={s.chipLabel}>{titleOf(id)}</span>
          <span className={s.docClose} onClick={(e) => { e.stopPropagation(); onClose(id); }}>×</span>
        </div>
      ))}
    </div>
  ) : (
    <div className={s.barChips}>
      {openIds.map((id) => (
        <div
          key={id}
          className={clsx(s.chip, view === "note" && id === activeId && s.chipOn)}
          onClick={() => onSelect(id)}
        >
          {bgRecordingId === id && <span className={s.recDot} />}
          <span className={s.chipLabel}>{titleOf(id)}</span>
          <span className={s.chipClose} onClick={(e) => { e.stopPropagation(); onClose(id); }}>×</span>
        </div>
      ))}
    </div>
  );

  const listView = (
    <div className={s.screen}>
      <h1 className={s.listHeading}>My notes</h1>
      {notes.slice(0, 5).map((n) => (
        <div key={n.id} className={s.card} onClick={() => onSelect(n.id)}>
          {n.title}
          <div className={s.cardMeta}>Yesterday · 3 to-dos</div>
        </div>
      ))}
      <p className={s.note}>
        {barScope === "always"
          ? "Bar scope = always: your open notes stay reachable from here."
          : "Bar scope = note-only: the notes you had open are hidden on this screen (today's behaviour)."}
      </p>
    </div>
  );

  if (view === "list") {
    return (
      <>
        {bar}
        {listView}
      </>
    );
  }

  const recBtn = (
    <button
      type="button"
      className={clsx(
        s.recBtn,
        st.recording && s.recBtnLive,
        !st.recording && bgRecordingId && s.recBtnDisabled,
      )}
      title={!st.recording && bgRecordingId ? `Already recording in ${titleOf(bgRecordingId)}` : undefined}
    >
      {st.recording ? <><span className={s.recDot} /> Stop</> : "Record"}
    </button>
  );

  const pasteBtn = <button type="button" className={s.ghostBtn}>Paste transcript</button>;

  const counts = {
    quick: st.hasQuick ? QUICK_LINES.length : 0,
    transcript: st.hasTranscript ? TRANSCRIPT_LINES.length : 0,
    final: st.hasFinal ? FINAL_POINTS.length : 0,
  };

  const strip =
    direction === "a" ? (
      <div className={s.tabRow}>
        <div className={s.underlineTabs}>
          <button type="button" className={clsx(s.uTab, tab === "quick" && s.uTabOn)} onClick={() => setTab("quick")}>
            Quick notes
          </button>
          {st.hasTranscript && (
            <button
              type="button"
              className={clsx(s.uTab, s.appearing, tab === "transcript" && s.uTabOn)}
              onClick={() => setTab("transcript")}
            >
              Transcript
            </button>
          )}
          {st.hasFinal && (
            <button
              type="button"
              className={clsx(s.uTab, s.appearing, tab === "final" && s.uTabOn)}
              onClick={() => setTab("final")}
            >
              Final notes
            </button>
          )}
        </div>
        <div className={s.rowControls}>
          {pasteBtn}
          {recBtn}
        </div>
      </div>
    ) : direction === "b" ? (
      <div className={s.toolbar}>
        <Segmented tab={tab} setTab={setTab} counts={counts} />
        <div className={s.rowControlsFlat}>
          {pasteBtn}
          {recBtn}
        </div>
      </div>
    ) : (
      <div className={s.toolbarC}>
        <Segmented tab={tab} setTab={setTab} counts={counts} />
        <span className={s.spacer} />
        {pasteBtn}
        {recBtn}
      </div>
    );

  return (
    <>
      {bar}
      <div className={s.screen}>
        <h1 className={s.noteTitle}>{titleOf(activeId)}</h1>
        <div className={s.noteMeta}>
          Today, 10:00 · Linked to <strong>Northwind weekly</strong> ·{" "}
          <span onClick={onGoList} style={{ cursor: "pointer", textDecoration: "underline" }}>
            back to notes
          </span>
        </div>
        {strip}
        <div className={s.panel}>
          {tab === "quick" && <QuickPanel has={st.hasQuick} />}
          {tab === "transcript" && <TranscriptPanel has={st.hasTranscript} live={st.recording} />}
          {tab === "final" && <FinalPanel has={st.hasFinal} hasTranscript={st.hasTranscript} />}
        </div>
      </div>
    </>
  );
}

function Segmented({
  tab,
  setTab,
  counts,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: { quick: number; transcript: number; final: number };
}) {
  const items: { id: Tab; label: string; n: number }[] = [
    { id: "quick", label: "Quick notes", n: counts.quick },
    { id: "transcript", label: "Transcript", n: counts.transcript },
    { id: "final", label: "Final notes", n: counts.final },
  ];
  return (
    <div className={s.segmented}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={clsx(s.sTab, tab === it.id && s.sTabOn, it.n === 0 && tab !== it.id && s.sTabEmpty)}
          onClick={() => setTab(it.id)}
        >
          {it.label}
          <span className={clsx(s.count, it.n === 0 && s.countEmpty)}>{it.n === 0 ? "–" : it.n}</span>
        </button>
      ))}
    </div>
  );
}

function QuickPanel({ has }: { has: boolean }) {
  if (!has) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>Nothing typed yet</div>
        <div className={s.emptyBody}>Start typing here during the meeting, or record and let the transcript do it.</div>
      </div>
    );
  }
  return (
    <>
      <div className={s.panelLabel}>Captured notes</div>
      <div className={s.body}>
        <ul>
          {QUICK_LINES.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>
    </>
  );
}

function TranscriptPanel({ has, live }: { has: boolean; live: boolean }) {
  if (!has) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>No transcript yet</div>
        <div className={s.emptyBody}>Record the meeting, or paste a transcript you already have.</div>
        <div className={s.emptyActions}>
          <button type="button" className={s.recBtn}>Record</button>
          <button type="button" className={s.ghostBtn}>Paste transcript</button>
        </div>
      </div>
    );
  }
  return (
    <>
      {live && <div className={s.liveTag}><span className={s.recDot} /> Recording</div>}
      <div className={s.panelLabel}>Transcript</div>
      <div className={s.body}>
        {TRANSCRIPT_LINES.slice(0, live ? 3 : 4).map(([sp, text]) => (
          <div key={text} className={s.line}>
            <span className={s.speaker}>{sp}:</span>
            {text}
          </div>
        ))}
      </div>
    </>
  );
}

function FinalPanel({ has, hasTranscript }: { has: boolean; hasTranscript: boolean }) {
  if (!has) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>No final notes yet</div>
        <div className={s.emptyBody}>
          {hasTranscript
            ? "Analyse the transcript to pull out discussion points, decisions and actions."
            : "Final notes are written from a transcript. Record or paste one first."}
        </div>
        <div className={s.emptyActions}>
          <button type="button" className={clsx(s.ghostBtn, !hasTranscript && s.recBtnDisabled)}>Analyse</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className={s.panelLabel}>Final notes</div>
      <div className={s.body}>
        <div className={s.subHeading}>Discussion points</div>
        <ul>{FINAL_POINTS.map((p) => <li key={p}>{p}</li>)}</ul>
        <div className={s.subHeading}>Decisions</div>
        <ul>{FINAL_DECISIONS.map((p) => <li key={p}>{p}</li>)}</ul>
        <div className={s.subHeading}>Actions</div>
        <ul>{FINAL_ACTIONS.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
    </>
  );
}
