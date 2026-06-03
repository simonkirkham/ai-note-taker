// Phase 15 prototype — Transcript / Quick notes / Final notes.
// Throwaway scaffolding on prototype/phase-15-note-tabs. Never merged.
// Two layouts behind a toggle:
//   A — persistent side panel (record + tags + actions always visible)
//   B — tabs own everything (record in header, actions inside Final notes, tags under title)
import { useState } from "react";
import "./prototype.css";

type Tab = "transcript" | "quick" | "final";
type Layout = "A" | "B";

// ── Sample data (the screenshot's meeting) ───────────────────────────────
const TITLE = "Spotify Icon Change and Brand Recognition Discussion";
const SUBTITLE = "2 Jun 2026 at 23:37 · 17:02";
const MODEL = "Qwen2.5-7B-Instruct-4bit";

const TRANSCRIPT = `Darminda: So I was thinking about the disco ball icon for Spotify's 20th year…
Rory Sutherland: A change like that is interesting because it forces re-recognition. Familiar logos are processed almost instantly…
Rory: The frequency with which we use an app is exactly why familiarity compounds. Friction at the icon level is friction everywhere.
Rory: Marketing, given to a department, gives everyone else the license to disregard psychological factors. It should be central to business strategy.
Rory: Finance got its status by comparison to consulting. Marketing should be elevated to a philosophy, not a function.
Rory: Data is a clue, not a fact. A business is an organism, not physics.`;

const QUICK_NOTES = `- disco ball icon idea for 20th year (Darminda)
- familiar logos = instant recognition
- friction at icon level matters because of usage frequency
- "marketing as a department" → license to disregard psychology
- TODO me: think about how this applies to our onboarding screen`;

const SUMMARY = `The meeting discussed the impact of changing a company's logo to increase usage, the importance of brand recognition, and the role of marketing in business strategy. Rory Sutherland highlighted how familiar logos are recognised instantly and how frequently-used apps benefit from this familiarity. The discussion also covered the challenges of introducing new features to infrequent users, and the need for marketing to be more than just a department — Rory emphasised understanding customer perspectives and the broader context of a business rather than relying solely on financial metrics.`;

const DISCUSSION = [
  "Darminda asked about creating a disco ball icon for Spotify's 20th year milestone. Rory noted such changes force re-recognition.",
  "Familiar logos are processed almost instantly — this highlights the importance of brand recognition.",
  "High-emotion products sell on emotional appeal; Rory suggested marketing leans on this.",
  "Infrequently-used apps make new features painful to introduce.",
  "Marketing as a 'department' gives everyone else license to disregard psychological factors.",
  "Finance gained status by comparison to consulting; marketing should be elevated to a philosophy.",
  "A business is an organism, not physics — data is a clue, not a fact.",
];

const DECISIONS = [
  "Establish a customer day for the board to understand the business from a customer perspective.",
];

const ACTIONS = [
  { who: "Rory", text: "give a talk in Leeds on Wednesday about marketing philosophy.", done: false },
  { who: "Rory", text: "continue to elevate the status of marketing as a philosophy within organizations.", done: false },
];

// ── Small building blocks ────────────────────────────────────────────────
function RecordButton({ recording, onToggle }: { recording: boolean; onToggle: () => void }) {
  return (
    <button className={`p-record ${recording ? "is-rec" : ""}`} onClick={onToggle}>
      <span className="p-dot" /> {recording ? "Stop · 00:42" : "Record"}
    </button>
  );
}

function TagsRow() {
  return (
    <div className="p-tags">
      {["branding", "marketing", "rory-stewart", "1:1"].map((t) => (
        <span key={t} className="p-tag">#{t}</span>
      ))}
    </div>
  );
}

function ActionItems() {
  return (
    <div className="p-actions">
      <div className="p-section-label">⃞ Action items</div>
      {ACTIONS.map((a, i) => (
        <label key={i} className="p-action">
          <input type="checkbox" defaultChecked={a.done} />
          <span className="p-action-who">{a.who}</span>
          <span>{a.text}</span>
        </label>
      ))}
    </div>
  );
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: [Tab, string][] = [
    ["transcript", "Transcript"],
    ["quick", "Quick notes"],
    ["final", "Final notes"],
  ];
  return (
    <div className="p-tabbar">
      {tabs.map(([id, label]) => (
        <button key={id} className={`p-tab ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Tab contents ─────────────────────────────────────────────────────────
function TranscriptTab() {
  return <pre className="p-transcript">{TRANSCRIPT}</pre>;
}

function QuickNotesTab() {
  return (
    <textarea className="p-quick" defaultValue={QUICK_NOTES} aria-label="Quick notes" />
  );
}

function FinalNotesTab({ populated, showActions }: { populated: boolean; showActions: boolean }) {
  if (!populated) {
    return (
      <div className="p-empty">
        <p className="p-empty-title">No final notes yet</p>
        <p className="p-empty-sub">Run analysis to turn your transcript and notes into a summary.</p>
        <button className="p-primary">✨ Generate final notes</button>
      </div>
    );
  }
  return (
    <div className="p-final">
      <div className="p-final-head">
        <span className="p-section-label">✨ Notes</span>
        <button className="p-ghost">⟳ Re-process</button>
      </div>
      <h3>≡ Summary</h3>
      <p>{SUMMARY}</p>
      <h3>💬 Discussion</h3>
      <ul>{DISCUSSION.map((d, i) => <li key={i}>{d}</li>)}</ul>
      <h3>✓ Decisions</h3>
      <ul>{DECISIONS.map((d, i) => <li key={i}>{d}</li>)}</ul>
      {showActions && <ActionItems />}
      <p className="p-attribution">Written by {MODEL} · 00:33</p>
    </div>
  );
}

function TabContent({ tab, populated, finalHasActions }: { tab: Tab; populated: boolean; finalHasActions: boolean }) {
  if (tab === "transcript") return <TranscriptTab />;
  if (tab === "quick") return <QuickNotesTab />;
  return <FinalNotesTab populated={populated} showActions={finalHasActions} />;
}

// ── Layout A: persistent side panel ──────────────────────────────────────
function LayoutA({ tab, setTab, recording, setRecording, populated }: LayoutProps) {
  return (
    <div className="p-note">
      <div className="p-title">{TITLE}</div>
      <div className="p-subtitle">{SUBTITLE}</div>
      <div className="p-layoutA">
        <div className="p-main">
          <TabBar tab={tab} setTab={setTab} />
          <div className="p-tabpanel"><TabContent tab={tab} populated={populated} finalHasActions={false} /></div>
        </div>
        <aside className="p-side">
          <RecordButton recording={recording} onToggle={() => setRecording(!recording)} />
          <div className="p-side-block">
            <div className="p-section-label">Tags</div>
            <TagsRow />
          </div>
          <div className="p-side-block">
            <ActionItems />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Layout B: tabs own everything ────────────────────────────────────────
function LayoutB({ tab, setTab, recording, setRecording, populated }: LayoutProps) {
  return (
    <div className="p-note">
      <div className="p-topbar">
        <RecordButton recording={recording} onToggle={() => setRecording(!recording)} />
        <button className="p-ghost">⤓ Export</button>
      </div>
      <div className="p-title">{TITLE}</div>
      <div className="p-subtitle">{SUBTITLE}</div>
      <TagsRow />
      <TabBar tab={tab} setTab={setTab} />
      {/* In Layout B, action items live inside Final notes (screenshot-faithful) */}
      <div className="p-tabpanel"><TabContent tab={tab} populated={populated} finalHasActions /></div>
    </div>
  );
}

type LayoutProps = {
  tab: Tab;
  setTab: (t: Tab) => void;
  recording: boolean;
  setRecording: (r: boolean) => void;
  populated: boolean;
};

// ── Root: layout toggle + state toggles ──────────────────────────────────
export function PrototypeRoot() {
  const [layout, setLayout] = useState<Layout>("A");
  const [tab, setTab] = useState<Tab>("final");
  const [recording, setRecording] = useState(false);
  const [populated, setPopulated] = useState(true);

  const props: LayoutProps = { tab, setTab, recording, setRecording, populated };

  return (
    <div className="p-root">
      <div className="p-controls">
        <strong>Phase 15 prototype</strong>
        <span className="p-seg">
          <button className={layout === "A" ? "on" : ""} onClick={() => setLayout("A")}>Layout A · side panel</button>
          <button className={layout === "B" ? "on" : ""} onClick={() => setLayout("B")}>Layout B · tabs own all</button>
        </span>
        <span className="p-seg">
          <button className={populated ? "on" : ""} onClick={() => setPopulated(true)}>Final: populated</button>
          <button className={!populated ? "on" : ""} onClick={() => setPopulated(false)}>Final: empty</button>
        </span>
        <span className="p-hint">switch tabs + toggle states to compare</span>
      </div>
      {layout === "A" ? <LayoutA {...props} /> : <LayoutB {...props} />}
    </div>
  );
}
