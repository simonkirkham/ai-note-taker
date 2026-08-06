# Phase 51 — Tabs redesign _(Not Started)_

**Goal:** Make the tabs on a note screen tell you at a glance what a note actually has in it, instead of showing the same three tabs whether or not there is anything behind them.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 51-A | A design, validated in a clickable prototype, for how the two tab strips on a note screen should look and behave | Not Started | — |
| 51-B | The agreed design shipped in the real app | Not Started | 51-A |

51-A is a **prototype spike** — its output is a locked design and rewritten scenarios for 51-B, not shipped code. 51-B cannot be specified until 51-A closes, so its scenarios below are placeholders.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 51-A — Prototype the tab design

- **User value:** The note screen currently stacks **two unrelated tab strips** on top of each other and the lower one lies about what the note contains. Getting this right is a design question, not a coding one, so it gets proved in a throwaway prototype before any real work.
- **The problems to solve** (what the prototype must answer):
  1. **Two tab strips, one screen.** The open-note bar across the top (one tab per note you have open) sits directly above the note's own view tabs. They look similar, mean completely different things, and reading them together is confusing.
  2. **Tabs that are always there whether or not they hold anything.** *Transcript* and *Final notes* are shown on **every** note — a note you have only typed in offers a Transcript tab with nothing in it and a Final notes tab you have to click to discover is empty. The tab strip should signal what the note has.
  3. **Tabs that appear and disappear unpredictably.** Whatever the rule for showing a tab is, it must be legible to the user — a tab that vanishes mid-task is worse than one that is always present but visibly empty.
  4. **They are ugly.** Visual treatment: hierarchy between the two strips, active/inactive states, spacing, and how the recording and paste-transcript controls sitting on the same row relate to them.
- **How it works:**
  - Run as a throwaway frontend-only prototype on a `prototype/` branch — no backend, no specs, never merged.
  - Present at least three genuinely different directions, not three shades of the current design. Candidate directions to cover: hide-until-populated, always-present-but-visibly-empty (badge/count/dimmed), and collapsing the two strips into a single hierarchy.
  - The user picks one; the exit procedure rewrites **this doc's 51-B section** with the confirmed scenarios and UX patterns.
- **Scenarios (GWT):** none — a spike has no acceptance scenarios. Its exit criterion is a design the user has approved and 51-B scenarios written into this doc.

### Slice 51-B — Ship the agreed design

- **User value:** _To be written by the 51-A exit procedure._
- **How it works:** _To be written by the 51-A exit procedure._
- **Scenarios (GWT):** _To be written by the 51-A exit procedure — do not implement from this doc until they exist._

---

## Build notes _(implementation — skip when reviewing)_

### 51-A
- **Run the `prototype` skill** ([`.claude/skills/prototype/SKILL.md`](../../.claude/skills/prototype/SKILL.md)). Worktree + branch per the CLAUDE.md prototype convention: `git worktree add ../ai-note-taker-slices/prototype-tabs-redesign -b prototype/tabs-redesign` (absolute path).
- **Current state to prototype against:**
  - *Open-note tab bar* — `web/src/components/OpenNoteTabs.tsx`, driven by `useOpenNoteTabs` (Phase 49-A). Deliberately **not** ARIA tabs (`role="tab"` obliges a matching `role="tabpanel"`; the panel here is the whole note screen) — see the comment at `OpenNoteTabs.tsx:7`. Returns `null` when no notes are open.
  - *Note view tabs* — `NoteView.tsx:32-38` (`NoteTab = "quick" | "transcript" | "final"`), rendered at `:746` as a real ARIA `role="tablist"` with three `role="tabpanel"`s at `:785` / `:854` / `:871`.
  - **Confirmed root of problem 2:** `TABS.map(...)` at `NoteView.tsx:747` has **no filter** — all three tabs render unconditionally, regardless of `transcriptText` / `transcriptDraft` / `summary`. The data needed to drive a conditional or badged tab strip is already in scope in the component (`transcriptText`, `transcriptDraft`, `summary`, `discussionPoints`, `decisions`, `isRecording`).
  - Styling lives in the `tabStyles` CSS module shared by the tab row, panels and `tabRowControls` (which hosts `PasteTranscript` + `RecordControl` on the same row as the tabs).
- **Constraint the prototype must respect:** a tab cannot simply disappear while recording — `activeTab` is force-set to `"transcript"` at `NoteView.tsx:474` when a recording starts. Any hide rule has to keep the active tab valid, and must not fight the BUG-34 / BUG-54 recording-leave guards.
- **Accessibility:** the note-view strip is a genuine ARIA tablist and must stay one. If a direction merges the two strips, re-check the `role="tab"`/`role="tabpanel"` pairing constraint that drove `OpenNoteTabs`' current markup.
- **Exit procedure:** on approval, cherry-pick **only** the rewritten phase-doc commit to `main`. Never merge `prototype/` into `main` or into a slice branch. Real implementation starts fresh from this doc, not from prototype code.

### 51-B
- _Not specified. Populated by the 51-A exit procedure._
- Expect it to be **frontend-only** (the data driving any conditional/badged tab is already loaded), but confirm at exit — if a direction needs a "has a transcript" or "has final notes" signal the client doesn't already hold, that changes the shape.

### Observability
- Deferred to the 51-A exit — run the `observability-brief` skill against 51-B's confirmed scenarios once they exist. The one failure mode already visible: a hide rule that mis-fires leaves a user unable to reach their transcript with no error, which is silent by construction.

### Deploy-time
- 51-A: **zero** — prototype branch, never deployed.
- 51-B: expected frontend-only → web deploy, **neutral**. Confirm at exit; if it turns out to need a backend field, the route-contract guardrail applies (a frontend-only deploy against an old backend 404s).
