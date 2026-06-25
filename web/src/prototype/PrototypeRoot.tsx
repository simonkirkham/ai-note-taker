// Throwaway UX prototype for CHANGE-27 — never merged. Frontend-only, no API, no auth.
// Three divergent designs for the Tags + Actions area, each in a realistic note-detail mock.
import { useState } from "react";
import "./prototype.css";

type Act = { id: string; text: string; done: boolean };
const SEED_TAGS = ["acme-corp", "project-atlas", "q3-planning", "budget"];
const SEED_ACTS: Act[] = [
  { id: "a1", text: "Send revised proposal to Acme by Friday", done: false },
  { id: "a2", text: "Book the Atlas kickoff room", done: true },
  { id: "a3", text: "Follow up with finance on the Q3 budget", done: false },
  { id: "a4", text: "Share these notes with the wider team", done: false },
];

let seq = 100;
function useData() {
  const [tags, setTags] = useState<string[]>(SEED_TAGS);
  const [acts, setActs] = useState<Act[]>(SEED_ACTS);
  return {
    tags, acts,
    open: acts.filter((a) => !a.done).length,
    done: acts.filter((a) => a.done).length,
    addTag: (t: string) => { const v = t.trim().toLowerCase(); if (v && !tags.includes(v)) setTags((p) => [...p, v]); },
    removeTag: (t: string) => setTags((p) => p.filter((x) => x !== t)),
    toggle: (id: string) => setActs((p) => p.map((a) => (a.id === id ? { ...a, done: !a.done } : a))),
    removeAct: (id: string) => setActs((p) => p.filter((a) => a.id !== id)),
    addAct: (t: string) => { const v = t.trim(); if (v) setActs((p) => [...p, { id: `a${seq++}`, text: v, done: false }]); },
    reset: () => { setTags(SEED_TAGS); setActs(SEED_ACTS); },
  };
}
type D = ReturnType<typeof useData>;

// Small inline "type and Enter to add" helper used by the ghost affordances.
function InlineAdd({ cls, placeholder, onAdd, onClose }: { cls: string; placeholder: string; onAdd: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState("");
  return (
    <input
      className={cls}
      autoFocus
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { onAdd(v); setV(""); }
        else if (e.key === "Escape") onClose();
      }}
      onBlur={() => { onAdd(v); onClose(); }}
    />
  );
}

// ---------- DESIGN 1: QUIET RAIL ----------
function QuietRail({ d }: { d: D }) {
  const [open, setOpen] = useState<"tags" | "acts" | null>("acts");
  return (
    <div className="sidebar">
      {/* Tags row */}
      <button className="qrRow" onClick={() => setOpen((o) => (o === "tags" ? null : "tags"))} aria-expanded={open === "tags"}>
        <span className={`qrChevron${open === "tags" ? " qrChevronOpen" : ""}`}>›</span>
        <span className="qrLabel">Tags</span>
        <span className="qrCount">· {d.tags.length}</span>
        {open !== "tags" && (
          <span className="qrPeek">
            {d.tags.slice(0, 2).map((t) => <span key={t} className="qrPeekPill">{t}</span>)}
            {d.tags.length > 2 && <span className="qrPeekMore">+{d.tags.length - 2}</span>}
          </span>
        )}
      </button>
      {open === "tags" && (
        <div className="qrBody">
          <div className="qrPills">
            {d.tags.map((t) => <span key={t} className="pill">{t}<button className="pillX" onClick={() => d.removeTag(t)}>×</button></span>)}
          </div>
          <InlineAdd cls="fauxInput" placeholder="Add tag…" onAdd={d.addTag} onClose={() => {}} />
        </div>
      )}
      {/* Actions row */}
      <button className="qrRow" onClick={() => setOpen((o) => (o === "acts" ? null : "acts"))} aria-expanded={open === "acts"}>
        <span className={`qrChevron${open === "acts" ? " qrChevronOpen" : ""}`}>›</span>
        <span className="qrLabel">Actions</span>
        <span className="qrCount">· {d.acts.length}</span>
        {open !== "acts" && (
          <span className="qrPeek">
            {d.open === 0 ? <span className="qrAllDone">All done ✓</span>
              : <span className="qrPeekStat">{d.done} done · <span className="open">{d.open} open</span></span>}
          </span>
        )}
      </button>
      {open === "acts" && (
        <div className="qrBody">
          <ul className="qrActList">
            {d.acts.map((a) => (
              <li key={a.id} className="qrActItem" style={a.done ? { color: "var(--color-text-muted)", textDecoration: "line-through" } : undefined}>
                <input type="checkbox" checked={a.done} onChange={() => d.toggle(a.id)} style={{ accentColor: "var(--color-primary)" }} />
                <span style={{ flex: 1 }}>{a.text}</span>
                <button className="actX" onClick={() => d.removeAct(a.id)}>×</button>
              </li>
            ))}
          </ul>
          <InlineAdd cls="fauxInput" placeholder="Add an action item…" onAdd={d.addAct} onClose={() => {}} />
        </div>
      )}
      <p className="footprint">Resting ≈ 89px · expands one section at a time</p>
    </div>
  );
}

// ---------- DESIGN 2: LEDGER ----------
function Ledger({ d }: { d: D }) {
  const [addTag, setAddTag] = useState(false);
  const [addAct, setAddAct] = useState(false);
  return (
    <div className="sidebar">
      <div className="lgBand">
        <div className="lgEyebrow"><span className="lgEyebrowLabel">Tags</span><span className="lgEyebrowCount">{d.tags.length}</span></div>
        <div className="lgChips">
          {d.tags.map((t) => <span key={t} className="lgChip">{t}<button className="pillX" onClick={() => d.removeTag(t)}>×</button></span>)}
          {addTag
            ? <InlineAdd cls="lgChipInput" placeholder="tag…" onAdd={d.addTag} onClose={() => setAddTag(false)} />
            : <button className="lgGhostChip" onClick={() => setAddTag(true)}>⊕ add</button>}
        </div>
      </div>
      <div className="lgBand">
        <div className="lgEyebrow"><span className="lgEyebrowLabel">Actions</span><span className="lgEyebrowCount">{d.done}/{d.acts.length}</span></div>
        <ul className="lgList">
          {d.acts.map((a) => (
            <li key={a.id} className={`lgItem${a.done ? " lgItemDone" : ""}`}>
              <input type="checkbox" checked={a.done} onChange={() => d.toggle(a.id)} />
              <span className="lgItemText" title={a.text}>{a.text}</span>
              <button className="actX" onClick={() => d.removeAct(a.id)}>×</button>
            </li>
          ))}
        </ul>
        {addAct
          ? <div className="lgGhostRow" style={{ cursor: "default" }}><span className="lgGhostPlus">＋</span><InlineAdd cls="lgRowInput" placeholder="Add an action…" onAdd={d.addAct} onClose={() => setAddAct(false)} /></div>
          : <button className="lgGhostRow" onClick={() => setAddAct(true)}><span className="lgGhostPlus">＋</span>Add an action…</button>}
      </div>
      <p className="footprint">Everything visible ≈ 185px (−~49%)</p>
    </div>
  );
}

// ---------- DESIGN 3: PROPERTY STRIP + ACTION DOCK ----------
function PropertyStrip({ d }: { d: D }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="propStrip">
      <span className="propGlyph">🏷</span>
      {d.tags.map((t) => <span key={t} className="pill">{t}<button className="pillX" onClick={() => d.removeTag(t)}>×</button></span>)}
      {adding
        ? <InlineAdd cls="stripInput" placeholder="Add tag…" onAdd={d.addTag} onClose={() => setAdding(false)} />
        : <button className="addTagChip" onClick={() => setAdding(true)}>＋ Add tag</button>}
    </div>
  );
}
function ActionDock({ d }: { d: D }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="dock">
      <button className={`dockHeader${d.open > 0 ? " dockHeaderActive" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dockTitle">✓ Actions <span className="dockCount">· {d.done} of {d.acts.length}</span></span>
        <span className={`dockChevron${open ? " dockChevronOpen" : ""}`}>⌄</span>
      </button>
      {open && (
        <div className="dockBody">
          {d.acts.map((a) => (
            <div key={a.id} className={`dockItem${a.done ? " dockItemDone" : ""}`}>
              <input type="checkbox" checked={a.done} onChange={() => d.toggle(a.id)} style={{ accentColor: "var(--color-primary)" }} />
              <span className="dockItemText">{a.text}</span>
              <button className="actX" onClick={() => d.removeAct(a.id)}>×</button>
            </div>
          ))}
          <InlineAdd cls="dockAddInput" placeholder="Add an action item…" onAdd={d.addAct} onClose={() => {}} />
        </div>
      )}
    </div>
  );
}

// ---------- shared chrome ----------
function Toolbar() {
  return (
    <div className="toolbar">
      <button className="btn btnPrimary">Save</button>
      <span className="toolSpacer" />
      <span className="dateChip">Tue 24 Jun</span>
      <button className="btn btnGhost">Move ▾</button>
      <button className="btn btnGhost">Delete</button>
    </div>
  );
}
function EditorColumn({ wide }: { wide?: boolean }) {
  return (
    <div className={`editorCard${wide ? " editorCardWide" : ""}`}>
      <div className="capturedLabel">Captured Notes</div>
      <div className="prose">
        <p><strong>Weekly sync — Project Atlas</strong></p>
        <p>Reviewed the migration timeline with the Acme team. The data backfill is the long pole; we agreed to run it over the weekend so the read projections are warm before Monday's demo. Finance still needs the revised Q3 figures before they can sign off on the extra headcount.</p>
        <p>Key points raised:</p>
        <ul>
          <li>Kickoff room is double-booked — Sam to find an alternative.</li>
          <li>Proposal needs the updated pricing table before it goes to Acme on Friday.</li>
          <li>Diarization spike looked promising; revisit after the demo.</li>
        </ul>
        <p>We'll reconvene Thursday once finance has come back, aiming to have the proposal out by end of week.</p>
      </div>
    </div>
  );
}
function Tabs() {
  return (
    <div className="tabs">
      <button className="tab tabActive">Quick notes</button>
      <button className="tab">Transcript</button>
      <button className="tab">Final notes</button>
    </div>
  );
}

const DESIGNS = {
  rail: { label: "1 · Quiet Rail", blurb: <><strong>Quiet Rail (progressive disclosure).</strong> Tags & Actions rest as two one-line rows showing a count + a peek. Tap a row to expand just that one; the other folds away. Resting footprint ~89px (−~80%). Trade: one click to edit, lists not all visible at rest.</> },
  ledger: { label: "2 · Ledger", blurb: <><strong>Ledger (compact density).</strong> Nothing hidden — both sections shrink: tiny eyebrow headings, tight inline chips with an "⊕ add" ghost, flat one-line action rows (~26px, no borders), and a "＋ Add" ghost row. ~185px (−~49%). Trade: smaller type + truncated long actions.</> },
  dock: { label: "3 · Strip + Dock", blurb: <><strong>Property Strip + Action Dock (relocate).</strong> The 320px sidebar is gone. Tags become a slim strip under the title; Actions become a collapsible dock under the editor (tinted while work remains). Editor goes full-width. Trade: a structural change; actions live below the fold.</> },
} as const;
type DesignKey = keyof typeof DESIGNS;

export function PrototypeRoot() {
  const d = useData();
  const [design, setDesign] = useState<DesignKey>("rail");
  return (
    <div className="protoPage">
      <div className="switcher">
        <span className="switcherTitle">CHANGE-27 · Tags + Actions redesign</span>
        {(Object.keys(DESIGNS) as DesignKey[]).map((k) => (
          <button key={k} className={`segBtn${design === k ? " segActive" : ""}`} onClick={() => setDesign(k)}>{DESIGNS[k].label}</button>
        ))}
        <button className="segBtn" onClick={d.reset}>↺ reset data</button>
        <span className="switcherNote">Interactive — toggle, add, remove. Throwaway prototype.</span>
      </div>
      <p className="designBlurb">{DESIGNS[design].blurb}</p>

      <div className="shell">
        <Toolbar />
        <input className="titleInput" defaultValue="Weekly sync — Project Atlas" />

        {design === "dock" ? (
          <div className="gridFull">
            <PropertyStrip d={d} />
            <Tabs />
            <EditorColumn wide />
            <ActionDock d={d} />
          </div>
        ) : (
          <div className="grid">
            <div>
              <Tabs />
              <EditorColumn />
            </div>
            {design === "rail" ? <QuietRail d={d} /> : <Ledger d={d} />}
          </div>
        )}
      </div>
    </div>
  );
}
