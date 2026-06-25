// Throwaway UX prototype for CHANGE-27 — never merged. Frontend-only, no API, no auth.
// FOUR full-width-editor designs for relocating Tags + Actions out of the side panel.
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

function InlineAdd({ cls, placeholder, onAdd, onClose }: { cls: string; placeholder: string; onAdd: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState("");
  return (
    <input
      className={cls} autoFocus value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { onAdd(v); setV(""); } else if (e.key === "Escape") onClose(); }}
      onBlur={() => { onAdd(v); onClose(); }}
    />
  );
}

// reusable full checklist (drawer / popover / dock / band)
function Checklist({ d, addPlaceholder }: { d: D; addPlaceholder: string }) {
  return (
    <>
      {d.acts.map((a) => (
        <div key={a.id} className={`row${a.done ? " rowDone" : ""}`}>
          <input type="checkbox" checked={a.done} onChange={() => d.toggle(a.id)} />
          <span className="rowText">{a.text}</span>
          <button className="actX" onClick={() => d.removeAct(a.id)}>×</button>
        </div>
      ))}
      <InlineAdd cls="addRowInput" placeholder={addPlaceholder} onAdd={d.addAct} onClose={() => {}} />
    </>
  );
}
function TagPills({ d }: { d: D }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="drawerPills">
      {d.tags.map((t) => <span key={t} className="pill">{t}<button className="pillX" onClick={() => d.removeTag(t)}>×</button></span>)}
      {adding ? <InlineAdd cls="stripInput" placeholder="Add tag…" onAdd={d.addTag} onClose={() => setAdding(false)} />
        : <button className="addTagChip" onClick={() => setAdding(true)}>＋ Add tag</button>}
    </div>
  );
}

// ---------- 4: COMMAND BAR ----------
function CommandBar({ d }: { d: D }) {
  const [adding, setAdding] = useState(false);
  const [pop, setPop] = useState(false);
  return (
    <div className="pbar">
      <div className="pbarLeft">
        <span className="pbarGlyph">🏷</span>
        {d.tags.map((t) => <span key={t} className="pill">{t}<button className="pillX" onClick={() => d.removeTag(t)}>×</button></span>)}
        {adding ? <InlineAdd cls="stripInput" placeholder="Add tag…" onAdd={d.addTag} onClose={() => setAdding(false)} />
          : <button className="addTagChip" onClick={() => setAdding(true)}>＋ tag</button>}
      </div>
      <div className="pbarRight">
        <button className={`actionsPill${pop ? " actionsPillActive" : ""}`} onClick={() => setPop((o) => !o)}>
          ✓ Actions <span className="actionsPillCount">· {d.done}/{d.acts.length}</span>
          <span className={`chev${pop ? " chevDown" : ""}`}>⌄</span>
        </button>
        {pop && (
          <div className="popover">
            <div className="popHeader"><span>Actions</span><span>{d.done}/{d.acts.length}</span></div>
            <div className="popBody"><Checklist d={d} addPlaceholder="Add an action item…" /></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 5: PINBOARD DRAWER ----------
function Pinboard({ d, open, setOpen }: { d: D; open: boolean; setOpen: (b: boolean) => void }) {
  return (
    <>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      {open && (
        <aside className="drawer" role="dialog" aria-label="Properties">
          <div className="drawerHeader"><span className="drawerHeaderLabel">Properties</span><button className="drawerClose" onClick={() => setOpen(false)}>×</button></div>
          <div className="drawerSection">
            <h3 className="secHeading">Tags</h3>
            <TagPills d={d} />
          </div>
          <div className="drawerSection">
            <h3 className="secHeading">Actions <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>{d.done}/{d.acts.length}</span></h3>
            <Checklist d={d} addPlaceholder="Add an action item…" />
          </div>
        </aside>
      )}
    </>
  );
}

// ---------- 6: PROPERTY BAND ----------
function PropertyBand({ d }: { d: D }) {
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  return (
    <div className="band">
      <div className="bandHead">
        {collapsed ? (
          <div className="bandCollapsedStrip">
            <span className="bandHeadLabel">Properties</span>
            {d.tags.slice(0, 4).map((t) => <span key={t} className="pillStatic">{t}</span>)}
            {d.tags.length > 4 && <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>+{d.tags.length - 4}</span>}
            <span className="bandMid">·</span>
            <span className="bandActionStat">✓ {d.done} / {d.acts.length} actions</span>
          </div>
        ) : <span className="bandHeadLabel">Properties</span>}
        <button className="bandChevBtn" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
          <span className={`chev${collapsed ? "" : " chevDown"}`}>⌄</span>
        </button>
      </div>
      {!collapsed && (
        <div className="bandGrid">
          <div>
            <div className="bandCap"><span>Tags</span></div>
            <div className="bandPills">
              {d.tags.map((t) => <span key={t} className="pill">{t}<button className="pillX" onClick={() => d.removeTag(t)}>×</button></span>)}
            </div>
            {adding ? <InlineAdd cls="fauxInput" placeholder="Add tag…" onAdd={d.addTag} onClose={() => setAdding(false)} />
              : <button className="addTagChip" onClick={() => setAdding(true)}>＋ Add tag</button>}
          </div>
          <div className="bandCol2">
            <div className="bandCap"><span>Actions</span><span className={d.open > 0 ? "bandCapOpen" : ""}>{d.open} open</span></div>
            <div className="bandList"><Checklist d={d} addPlaceholder="Add an action item…" /></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 3: STRIP + DOCK (reference) ----------
function StripDock({ d }: { d: D }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="propStrip">
        <span className="propGlyph">🏷</span>
        {d.tags.map((t) => <span key={t} className="pill">{t}<button className="pillX" onClick={() => d.removeTag(t)}>×</button></span>)}
        {adding ? <InlineAdd cls="stripInput" placeholder="Add tag…" onAdd={d.addTag} onClose={() => setAdding(false)} />
          : <button className="addTagChip" onClick={() => setAdding(true)}>＋ Add tag</button>}
      </div>
      <Tabs />
      <EditorColumn />
      <div className="dock">
        <button className={`dockHeader${d.open > 0 ? " dockHeaderActive" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="dockTitle">✓ Actions <span className="dockCount">· {d.done} of {d.acts.length}</span></span>
          <span className={`chev${open ? " chevDown" : ""}`}>⌄</span>
        </button>
        {open && <div className="dockBody"><Checklist d={d} addPlaceholder="Add an action item…" /></div>}
      </div>
    </>
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
function Tabs({ right }: { right?: React.ReactNode }) {
  return (
    <div className="tabsRow">
      <div className="tabs">
        <button className="tab tabActive">Quick notes</button>
        <button className="tab">Transcript</button>
        <button className="tab">Final notes</button>
      </div>
      {right}
    </div>
  );
}
function EditorColumn() {
  return (
    <div className="editorCard">
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

const DESIGNS = {
  bar: { label: "4 · Command Bar", blurb: <><strong>Unified Command Bar.</strong> One slim 40px line under the title: tags as inline chips on the left, an "✓ Actions · 2/4" pill on the right that opens a popover checklist. Editor full-width below. Nothing ever adds page height — the popover floats.</> },
  pin: { label: "5 · Pinboard", blurb: <><strong>Pinboard drawer.</strong> Editor is full-width at all times. A top-right pin shows live counts (🏷 4 · ✓ 2/4); click it to slide a properties drawer over the note with the full tags + actions. Closes on ×, scrim, or Esc.</> },
  band: { label: "6 · Property Band", blurb: <><strong>Property Band.</strong> A tidy two-up header above the notes — Tags left, Actions right, side by side — costing a few rows instead of a tall stack. Collapses to one summary line. Notes run full-width below.</> },
  dock: { label: "3 · Strip + Dock", blurb: <><strong>Strip + Dock (your earlier pick, for reference).</strong> Tags strip under the title; actions in a collapsible dock under the editor.</> },
} as const;
type DesignKey = keyof typeof DESIGNS;

export function PrototypeRoot() {
  const d = useData();
  const [design, setDesign] = useState<DesignKey>("bar");
  const [pinOpen, setPinOpen] = useState(false);
  return (
    <div className="protoPage">
      <div className="switcher">
        <span className="switcherTitle">CHANGE-27 · full-width options</span>
        {(Object.keys(DESIGNS) as DesignKey[]).map((k) => (
          <button key={k} className={`segBtn${design === k ? " segActive" : ""}`} onClick={() => { setDesign(k); setPinOpen(false); }}>{DESIGNS[k].label}</button>
        ))}
        <button className="segBtn" onClick={d.reset}>↺ reset</button>
        <span className="switcherNote">Interactive — toggle, add, remove. Throwaway.</span>
      </div>
      <p className="designBlurb">{DESIGNS[design].blurb}</p>

      <div className="shell">
        <Toolbar />
        <input className="titleInput" defaultValue="Weekly sync — Project Atlas" />

        {design === "dock" && <StripDock d={d} />}

        {design === "bar" && (<><CommandBar d={d} /><Tabs /><EditorColumn /></>)}

        {design === "band" && (<><PropertyBand d={d} /><Tabs /><EditorColumn /></>)}

        {design === "pin" && (
          <>
            <Tabs right={
              <button className={`pin${pinOpen ? " pinActive" : ""}`} onClick={() => setPinOpen((o) => !o)}>
                🏷 <span className="pinNum">{d.tags.length}</span> <span className="pinSep">·</span> ✓ <span className="pinNum">{d.done}/{d.acts.length}</span> <span className="chev">⌄</span>
              </button>
            } />
            <EditorColumn />
            <Pinboard d={d} open={pinOpen} setOpen={setPinOpen} />
          </>
        )}

        <p className="footprint">Editor runs full width in every option here — the 320px sidebar is gone.</p>
      </div>
    </div>
  );
}
