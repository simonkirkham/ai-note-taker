// Prototype only — throwaway fixtures. No types worth sharing, no tests.

export type DirectionId = "today" | "a" | "b" | "c";
export type ViewId = "list" | "folder" | "search" | "note";

export const DIRECTIONS: { id: DirectionId; name: string; pitch: string }[] = [
  {
    id: "today",
    name: "Today (baseline)",
    pitch:
      "What ships now. The bar exists only on a note screen. Click My notes and every open note vanishes; open any note and the whole set slams back. Click between My notes and a note a few times — that flicker is the thing being fixed.",
  },
  {
    id: "a",
    name: "A · My notes is a tab",
    pitch:
      "The notes list becomes the permanent leftmost tab — pinned, no close button. The bar is then always present and something is always active, so nothing ever appears or disappears. Going Home is just clicking the first tab.",
  },
  {
    id: "b",
    name: "B · Bar is always there",
    pitch:
      "The same bar, kept on every screen. My notes stays in the sidebar where it is. Simpler than A and no new concept, but on the list screen no tab is active — the bar sits there representing notes you are not looking at.",
  },
  {
    id: "c",
    name: "C · Open notes move to the sidebar",
    pitch:
      "No horizontal strip at all. Open notes become a section of the left sidebar, listed vertically under the navigation. Always visible because the sidebar always is — and the note screen is left with only one tab strip, its own.",
  },
];

export const NOTES = [
  { id: "n1", title: "Standup", meta: "Today, 09:30 · 2 to-dos" },
  { id: "n2", title: "Client call — Northwind", meta: "Today, 10:00 · 3 to-dos" },
  { id: "n3", title: "Roadmap review", meta: "Yesterday · 1 to-do" },
  { id: "n4", title: "1:1 with Priya", meta: "Yesterday · no to-dos" },
  { id: "n5", title: "Incident postmortem — projector lag", meta: "Mon · 5 to-dos" },
  { id: "n6", title: "Hiring loop debrief", meta: "Mon · 2 to-dos" },
  { id: "n7", title: "Q3 planning", meta: "Last week · 4 to-dos" },
  { id: "n8", title: "Vendor security review", meta: "Last week · no to-dos" },
];

export const QUICK_LINES = [
  "Northwind want the pilot extended to two more teams",
  "Blocker: their SSO tenant isn't provisioned yet",
  "Ask Priya for the revised timeline before Thursday",
];
