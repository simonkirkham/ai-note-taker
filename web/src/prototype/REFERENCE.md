# Phase 15 prototype — REFERENCE

Confirmed UX for the Transcript / Quick notes / Final notes note view. The real
implementation rebuilds from scratch on `slice/...` branches using the GWT
scenarios in `docs/phases/phase-15.md` (on main) + this file. **Do not copy
prototype code** — it is throwaway scaffolding (`web/src/prototype/`, wired via a
`#prototype` hash short-circuit in `main.tsx`, never merged).

## Confirmed layout (Layout B hybrid)

```
 Title
 2 Jun 2026 at 23:37 · 17:02
┌───────────────────────────────────────────────┬───────────────┐
│ [Quick notes][Transcript][Final notes]  ● Rec ⤓ Export          │
├───────────────────────────────────────────────┼───────────────┤
│                                                │  Tags          │
│   (active tab panel)                           │  #branding …   │
│                                                │                │
│                                                │  ⃞ Action items │
│                                                │  ☐ Rory …      │
└───────────────────────────────────────────────┴───────────────┘
```

- **Tabs:** `Quick notes` · `Transcript` · `Final notes`, in that order.
- **Default tab:** **Quick notes**, for *all* notes (analysed or not). (Considered opening analysed notes on Final notes; decided against — keep it simple, revisit later if desired.)
- **Record + Export** sit **inline on the tab row, right-aligned**, level with the tabs — not in a separate header, not in the sidebar.
- **Tags + Action items** live in a **persistent right sidebar**, visible on every tab (carried over from today's `TagsSection` / `ActionsSection` right panel).
- **Final notes** renders **Summary → Discussion → Decisions** + a `Written by {model}` attribution line. **Action items are NOT shown inside Final notes** — they remain in the sidebar (single home). This differs from the original screenshot, which folded actions into Final notes.
- **Transcript tab** is read-only.
- **Quick notes tab** is the editable note body (today's `NoteEditor`); the AI never writes here.

## States

- **Final notes — populated:** Summary paragraph, Discussion bullets, Decisions bullets, attribution, and a `⟳ Re-process` control in the section header.
- **Final notes — empty (never analysed):** a centred "No final notes yet" message + sub-text + a primary `✨ Generate final notes` button. Must be visually distinct from an error/failure state.
- **Recording:** the Record button toggles to a filled red `Stop · mm:ss` state.

## API shapes implied (for the real slices)

- `GET /notes/{id}` (`NoteDetail`) must additionally return: `summary` (string|null), `discussionPoints` (string[]), `decisions` (string[]), `summaryModelId` (string|null), `summaryPromptVersion` (string|null). Transcript already returns via `transcriptText`. Action items continue to come from the existing actions data (`NoteActions`) — Final notes does **not** consume them.
- Generate / Re-process calls the existing `POST /notes/{id}/analyse` (no `updateContent` field in the new contract).

## Component decisions

- Tab control owns three panels; Quick notes = existing `NoteEditor`, Transcript = new read-only view, Final notes = new view (Summary/Discussion/Decisions + attribution + generate/re-process control).
- The right sidebar keeps `TagsSection` + `ActionsSection` essentially as they are today — they are *not* moved into tabs.
- Record/Export controls move from the right panel onto the tab row.

## localStorage keys

None — the prototype is stateless beyond in-memory `useState` toggles.
