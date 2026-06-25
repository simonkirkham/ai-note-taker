// Throwaway UX prototype for CHANGE-28 — never merged. Frontend-only.
// Typography playground for the notes body text ("too big" today). Live font /
// size / line-height controls + curated presets, rendered exactly like the editor.
import { useEffect, useMemo, useState } from "react";
import "./prototype.css";

const FONTS = [
  { label: "Plus Jakarta Sans (current)", css: "'Plus Jakarta Sans', sans-serif" },
  { label: "Inter", css: "'Inter', sans-serif" },
  { label: "System UI", css: "system-ui, -apple-system, sans-serif" },
  { label: "Source Serif 4 (serif)", css: "'Source Serif 4', Georgia, serif" },
  { label: "Lora (serif)", css: "'Lora', Georgia, serif" },
  { label: "Georgia (serif)", css: "Georgia, 'Times New Roman', serif" },
  { label: "IBM Plex Mono", css: "'IBM Plex Mono', ui-monospace, monospace" },
];

// Each preset is [fontIndex, px, lineHeight].
const PRESETS: Record<string, { font: number; px: number; lh: number; blurb: string }> = {
  "Current": { font: 0, px: 16, lh: 1.75, blurb: "Today's setting — Plus Jakarta Sans, 16px, line-height 1.75." },
  "Compact": { font: 0, px: 14, lh: 1.55, blurb: "Same font, smaller + tighter — fits much more on screen." },
  "Comfortable": { font: 0, px: 15, lh: 1.6, blurb: "A touch smaller than today, still airy." },
  "Inter clean": { font: 1, px: 15, lh: 1.6, blurb: "Inter — a crisp UI sans at a calmer size." },
  "Reading serif": { font: 3, px: 16, lh: 1.65, blurb: "Source Serif — a document/reading feel." },
};

function presetMatch(font: number, px: number, lh: number): string | null {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (p.font === font && p.px === px && p.lh === lh) return name;
  }
  return null;
}

export function PrototypeRoot() {
  const [font, setFont] = useState(0);
  const [px, setPx] = useState(16);
  const [lh, setLh] = useState(1.75);

  useEffect(() => {
    const id = "proto-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Lora:wght@400;600;700&family=Source+Serif+4:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap";
    document.head.appendChild(link);
  }, []);

  function applyPreset(name: string) {
    const p = PRESETS[name];
    setFont(p.font); setPx(p.px); setLh(p.lh);
  }

  const active = presetMatch(font, px, lh);
  const isCurrent = active === "Current";
  const rem = +(px / 16).toFixed(4);
  const previewStyle = useMemo(
    () => ({ fontFamily: FONTS[font].css, fontSize: `${px}px`, lineHeight: lh }),
    [font, px, lh],
  );

  return (
    <div className="protoPage">
      <div className="switcher">
        <span className="switcherTitle">CHANGE-28 · Notes text size</span>
        <span className="presetLabel">Presets:</span>
        {Object.keys(PRESETS).map((name) => (
          <button key={name} className={`segBtn${active === name ? " segActive" : ""}`} onClick={() => applyPreset(name)}>{name}</button>
        ))}
        <span className="switcherNote">Or fine-tune with the controls. Throwaway prototype.</span>
      </div>

      <div className="shell">
        <div className="playWrap">
          <div className="controls">
            <div className="ctrlGroup">
              <label className="ctrlLabel" htmlFor="pf">Font</label>
              <select id="pf" value={font} onChange={(e) => setFont(Number(e.target.value))}>
                {FONTS.map((f, i) => <option key={f.label} value={i}>{f.label}</option>)}
              </select>
            </div>
            <div className="ctrlGroup">
              <label className="ctrlLabel" htmlFor="ps">Size · <span className="ctrlValue">{px}px ({rem}rem)</span></label>
              <input id="ps" type="range" min={13} max={18} step={0.5} value={px} onChange={(e) => setPx(Number(e.target.value))} />
            </div>
            <div className="ctrlGroup">
              <label className="ctrlLabel" htmlFor="pl">Line height · <span className="ctrlValue">{lh}</span></label>
              <input id="pl" type="range" min={1.3} max={1.9} step={0.05} value={lh} onChange={(e) => setLh(Number(e.target.value))} />
            </div>
            <button className="resetBtn" onClick={() => applyPreset("Current")}>↺ Reset to current</button>
            <p className="currentNote">
              {isCurrent
                ? <span className="isCurrent">▶ This is exactly today's setting.</span>
                : <>Today: Plus Jakarta Sans · 16px · 1.75.<br />{active ? `Preset: ${active}.` : "Custom."}</>}
            </p>
          </div>

          <div className="noteCard">
            <div className="capturedLabel">Captured Notes</div>
            <div className="body" style={previewStyle}>
              <h2>Weekly sync — Project Atlas</h2>
              <p>Reviewed the migration timeline with the Acme team. The data backfill is the long pole; we agreed to run it over the weekend so the read projections are warm before Monday's demo.</p>
              <p>Finance still needs the revised Q3 figures before they can sign off on the extra headcount. Sam is chasing it and will confirm by Thursday.</p>
              <h3>Key points</h3>
              <ul>
                <li>Kickoff room is double-booked — Sam to find an alternative.</li>
                <li>Proposal needs the updated pricing table before it goes to Acme on Friday.</li>
                <li>Diarization spike looked promising; revisit after the demo.</li>
                <li>Legal want a redlined SOW before sign-off — owner TBD.</li>
              </ul>
              <h3>Decisions</h3>
              <p>Run the backfill Saturday 06:00. Demo stays Monday 10:00. We'll reconvene Thursday once finance has come back, aiming to have the proposal out by end of week.</p>
              <p>Next steps tracked in the actions panel; notes shared with the wider team afterwards.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
