// Phase 15 prototype — Transcript / Quick notes / Final notes.
// Throwaway scaffolding on prototype/phase-15-note-tabs. Never merged.
// CONFIRMED layout (Layout B hybrid):
//   - Tab row: tabs left, Record + Export inline on the right
//   - Quick notes is the first + default tab
//   - Tags + Action items live in a persistent right sidebar (visible on every tab)
//   - Final notes holds Summary / Discussion / Decisions only (actions are in the sidebar)
import { useState } from "react";
import "./prototype.css";

type Tab = "quick" | "transcript" | "final";

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
    ["quick", "Quick notes"],
    ["transcript", "Transcript"],
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
  return <textarea className="p-quick" defaultValue={QUICK_NOTES} aria-label="Quick notes" />;
}

function FinalNotesTab({ populated }: { populated: boolean }) {
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
      <p className="p-attribution">Written by {MODEL} · 00:33</p>
    </div>
  );
}

function TabContent({ tab, populated }: { tab: Tab; populated: boolean }) {
  if (tab === "transcript") return <TranscriptTab />;
  if (tab === "quick") return <QuickNotesTab />;
  return <FinalNotesTab populated={populated} />;
}

// ── Root ─────────────────────────────────────────────────────────────────
export function PrototypeRoot() {
  const [tab, setTab] = useState<Tab>("quick");
  const [recording, setRecording] = useState(false);
  const [populated, setPopulated] = useState(true);

  return (
    <div className="p-root">
      <div className="p-controls">
        <strong>Phase 15 prototype</strong>
        <span className="p-seg">
          <button className={populated ? "on" : ""} onClick={() => setPopulated(true)}>Final: populated</button>
          <button className={!populated ? "on" : ""} onClick={() => setPopulated(false)}>Final: empty</button>
        </span>
        <span className="p-hint">Layout B hybrid · record/export inline · tags + actions in sidebar</span>
      </div>

      <div className="p-note">
        <div className="p-title">{TITLE}</div>
        <div className="p-subtitle">{SUBTITLE}</div>

        {/* Tab row: tabs left, record/export inline on the right */}
        <div className="p-tabrow">
          <TabBar tab={tab} setTab={setTab} />
          <div className="p-tabrow-actions">
            <RecordButton recording={recording} onToggle={() => setRecording(!recording)} />
            <button className="p-ghost">⤓ Export</button>
          </div>
        </div>

        {/* Main tab panel + persistent sidebar (tags + actions) */}
        <div className="p-layout">
          <div className="p-main">
            <div className="p-tabpanel"><TabContent tab={tab} populated={populated} /></div>
          </div>
          <aside className="p-side">
            <div className="p-side-block">
              <div className="p-section-label">Tags</div>
              <div className="p-tags">
                {["branding", "marketing", "rory-stewart", "1:1"].map((t) => (
                  <span key={t} className="p-tag">#{t}</span>
                ))}
              </div>
            </div>
            <div className="p-side-block">
              <ActionItems />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
