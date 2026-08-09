// Prototype only — throwaway fixtures. No types worth sharing, no tests.

export type DirectionId = "a" | "b" | "c";
export type StateId = "blank" | "typed" | "recording" | "captured" | "analysed";
export type BarScope = "note-only" | "always";
export type ViewId = "list" | "note";

export const DIRECTIONS: { id: DirectionId; name: string; pitch: string }[] = [
  {
    id: "a",
    name: "A · Earned tabs",
    pitch:
      "A view tab exists only once it holds something. Most notes show one or two, so the lower strip stops mirroring the upper one and the collision largely dissolves.",
  },
  {
    id: "b",
    name: "B · Honest tabs",
    pitch:
      "All three view tabs, always, with their state on the face: empty is dimmed with a dash, populated carries a count. Nothing ever moves. The lower strip becomes a segmented control so the two strips are different shapes.",
  },
  {
    id: "c",
    name: "C · One hierarchy",
    pitch:
      "Only one thing on screen looks like tabs. Open notes become full-bleed document tabs at the top of the frame; the note's own views drop into the toolbar as a segmented control beside Record and Paste.",
  },
];

export const STATES: {
  id: StateId;
  label: string;
  hasQuick: boolean;
  hasTranscript: boolean;
  hasFinal: boolean;
  recording: boolean;
}[] = [
  { id: "blank", label: "Nothing captured yet", hasQuick: false, hasTranscript: false, hasFinal: false, recording: false },
  { id: "typed", label: "Typed notes only", hasQuick: true, hasTranscript: false, hasFinal: false, recording: false },
  { id: "recording", label: "Recording in progress", hasQuick: true, hasTranscript: true, hasFinal: false, recording: true },
  { id: "captured", label: "Transcript, not analysed", hasQuick: true, hasTranscript: true, hasFinal: false, recording: false },
  { id: "analysed", label: "Fully analysed", hasQuick: true, hasTranscript: true, hasFinal: true, recording: false },
];

export const NOTES = [
  { id: "n1", title: "Standup" },
  { id: "n2", title: "Client call — Northwind" },
  { id: "n3", title: "Roadmap review" },
  { id: "n4", title: "1:1 with Priya" },
  { id: "n5", title: "Incident postmortem — projector lag" },
  { id: "n6", title: "Hiring loop debrief" },
  { id: "n7", title: "Q3 planning" },
  { id: "n8", title: "Vendor security review" },
];

export const QUICK_LINES = [
  "Northwind want the pilot extended to two more teams",
  "Blocker: their SSO tenant isn't provisioned yet",
  "Ask Priya for the revised timeline before Thursday",
];

export const TRANSCRIPT_LINES = [
  ["Speaker 1", "So where did we land on the pilot scope?"],
  ["Speaker 2", "Two more teams, but we need the SSO tenant first."],
  ["Speaker 1", "That's on Northwind's side — I'll chase it today."],
  ["Speaker 2", "If it slips past Thursday the timeline moves."],
];

export const FINAL_POINTS = [
  "Pilot extends to two additional teams",
  "SSO tenant provisioning is the critical path",
  "Timeline slips if the tenant isn't ready by Thursday",
];

export const FINAL_DECISIONS = ["Extend the pilot", "Hold the launch date pending SSO"];
export const FINAL_ACTIONS = ["Chase Northwind on the SSO tenant — today", "Priya to reissue the timeline"];
