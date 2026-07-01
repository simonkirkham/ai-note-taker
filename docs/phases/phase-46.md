# Phase 46 — Richer markdown in notes: tables, task lists, emoji _(Not Started)_

**Goal:** A note's markdown renders GFM tables as a real grid, `- [ ]` / `- [x]` as clickable checkboxes, and `:shortcode:` emoji as the glyph — instead of a collapsed run-on line, literal `[]`/`[x]` text, or raw `:code:`.

## Summary

| Slice | What the user gets | Status | Depends on |
|-------|--------------------|--------|------------|
| 46-A | Tables in a note show as a real grid with rows, columns, and alignment — not one run-on line | Done _(#381, deploy #686)_ | — |
| 46-B | Checklist items render as checkboxes you can tick, and the tick is saved | Done _(#383, deploy #687)_ | — |
| 46-C | Emoji shortcodes like `:tada:` appear as 🎉 | Not Started | — |

46-A and 46-B are independent P0 fixes for markdown that renders unusably today — do the highest-impact tables first, then task lists. 46-C is a lower-priority P1 nicety and depends on neither.

## Slices

<!-- REVIEW SURFACE — the human reads this and stops. No technical artefact named below. -->

### Slice 46-A — Tables render as a grid

- **User value:** OGI notes that use tables (present in 10+ files) become readable — a bordered grid, not a single collapsed string.
- **How it works:**
  - A note whose markdown holds a GFM pipe table (header row, a `---` separator row, optional `:` alignment markers) opens as a bordered grid: each row on its own line, each cell in its own column.
  - Left / centre / right alignment from `:---`, `:---:`, `---:` is honoured per column.
  - Editing text inside a cell and saving keeps the table — it round-trips back to a valid markdown table.
  - Scope: this slice **renders and text-edits** tables. It does not add on-canvas buttons to insert/delete rows or columns (a possible later tweak).
- **Scenarios (GWT):**

```
Scenario: GFM table renders as a grid
  Given a note whose markdown contains a pipe table with a header row and a --- separator
  When  the note opens
  Then  each row and cell renders as its own grid cell, not a single run-on line

Scenario: Column alignment is honoured
  Given a table column whose separator is :---: (centre) or ---: (right)
  When  the note opens
  Then  that column's cells are centre- or right-aligned

Scenario: Editing a cell round-trips to markdown
  Given a rendered table in an open note
  When  the user edits a cell's text and the note saves
  Then  the saved markdown still contains a valid pipe table carrying the edit

Scenario: A malformed table does not blank the note
  Given a note with an unbalanced / incomplete pipe table
  When  the note opens
  Then  the content still renders (as text) and the editor does not crash or wipe the note
```

### Slice 46-B — Task lists render as tickable checkboxes

- **User value:** checklists in a note become interactive — tick an item off in place and the tick sticks.
- **How it works:**
  - `- [ ]` renders as an empty checkbox and `- [x]` as a checked one, with no literal `[]` / `[x]` brackets shown.
  - Clicking a checkbox toggles it immediately (optimistic); the note saves the new state on the same change.
  - Toggling round-trips: a ticked box serializes back to `- [x] …`, an unticked one to `- [ ] …`.
  - Nested checklists indent under their parent.
- **Scenarios (GWT):**

```
Scenario: Task items render as checkboxes
  Given a note whose markdown contains "- [ ] buy milk" and "- [x] send invoice"
  When  the note opens
  Then  "buy milk" shows an unchecked checkbox and "send invoice" a checked one, with no literal brackets

Scenario: Clicking a checkbox toggles it and saves
  Given a rendered unchecked task item
  When  the user clicks its checkbox
  Then  it becomes checked immediately
  And   the saved markdown for that line becomes "- [x] …"

Scenario: Checked state round-trips
  Given a note with a checked task item
  When  the note is saved and reopened
  Then  the item is still checked
```

### Slice 46-C — Emoji shortcodes render as emoji

- **User value:** shortcodes people paste or type (`:tada:`, `:rocket:`) show as the emoji rather than raw text.
- **How it works:**
  - A known `:shortcode:` in the note markdown displays as its emoji glyph when the note opens.
  - Typing a known shortcode in the body converts it in place once completed (`:rocket:` → 🚀).
  - An unknown shortcode is left exactly as typed — no substitution, no error.
- **Scenarios (GWT):**

```
Scenario: Known shortcode renders as emoji
  Given a note whose markdown contains ":tada:"
  When  the note opens
  Then  it displays 🎉

Scenario: Unknown shortcode is left untouched
  Given a note containing ":not_a_real_code:"
  When  the note opens
  Then  the literal text ":not_a_real_code:" is shown

Scenario: Typing a shortcode converts it live
  Given the cursor in the note body
  When  the user types ":rocket:"
  Then  it becomes 🚀 in place
```

---

## Build notes _(implementation — skip when reviewing)_

**Architecture note (read first).** This is a **frontend-only** phase. Notes are edited in a Tiptap WYSIWYG editor (`web/src/components/NoteEditor.tsx`); markdown is only the storage format, produced/consumed by `tiptap-markdown` (which wraps **markdown-it**). There is **no** react-markdown/remark/rehype renderer to swap. The P0 breakage is a **missing ProseMirror schema node**, not a missing parser: `tiptap-markdown` already parses tables (markdown-it default preset) and task lists (it bundles `markdown-it-task-lists`), and already ships serialize specs for `table` / `tableHeader` / `taskList` / `taskItem` — so both round-trip once the matching Tiptap node extensions are added to the editor's `extensions` array. No new events, commands, projections, API routes, or CDK changes in any slice.

### 46-A
- **Events/commands / Projections / API:** none — frontend only.
- **Extensions:** install `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-header`, `@tiptap/extension-table-cell`, **pinned to the same 3.23.x line as the other `@tiptap/*`** (avoid the Tiptap ERESOLVE / lockfile skew — see the `package-lock` and Tiptap-exact-pin guardrails; regenerate the lockfile incrementally on CI's npm version). Add `Table.configure({ resizable: false })`, `TableRow`, `TableHeader`, `TableCell` to the `extensions` array in `NoteEditor.tsx`.
- **Parse/serialize:** As shipped, `@tiptap/extension-table` v3 has **no default export** — use the named `Table`/`TableRow`/`TableHeader`/`TableCell` (the single package supplies all four, so the three separate `-row`/`-header`/`-cell` packages are not needed). tiptap-markdown parses tables (markdown-it default) but its **default serializer drops column alignment** (`| --- |`); `MarkdownTable` (in `web/src/lib/markdownTable.ts`) overrides only the `serialize` half of the table markdown spec via `addStorage().markdown.serialize` (tiptap-markdown merges `{...default, ...mine}`, so the default parser is preserved) to emit `:---`/`:---:`/`---:` from each column's `align` attr. Inline marks and escaped pipes round-trip too.
- **CSS:** scoped `.contentInput table / th / td` rules in `NoteEditor.module.css` (`border-collapse`, cell borders via `var(--color-border)`, header background, cell padding; per-cell `text-align` comes from the extension's inline style). ProseMirror runtime classes (e.g. `selectedCell`) are deliberately **not** styled — CSS Modules would hash them.
- **Tests:** `tableMarkdownRoundTrip.test.ts` (grid structure, alignment round-trip, inline-mark + escaped-pipe fidelity, idempotency, tables-in-context, empty cell, malformed no-throw); render gate in `NoteEditor.test.tsx` (pipe table → `<table>` with separate cells + per-column `text-align`).
- **Acceptance criteria:**
  - [x] A GFM pipe table renders as `<table>` with one cell per pipe-delimited value, header row distinct.
  - [x] `:---:` / `---:` alignment is applied per column.
  - [x] Editing a cell and re-serializing yields a valid pipe table with the edit.
  - [x] A malformed table does not crash the editor or blank the note.
- **Decisions:** minimal table UX this slice — render + in-cell text edit + round-trip only; no insert/remove row-column chrome. `resizable: false`. **Went beyond the spec's "alignment survives as the align attr" assumption** — the default serializer silently strips alignment on the first edit-save, so a custom serialize override was required (Hawk caught a `state.closed` side-effect bug in it: cell rendering cleared the pending block-close, gluing a table onto the preceding block → fixed by snapshot/restore, with tables-in-context tests added).

### 46-B
- **Events/commands / Projections / API:** none — frontend only.
- **Extensions:** wire the **already-installed** `@tiptap/extension-task-list` (`TaskList`) and `@tiptap/extension-task-item` (`TaskItem.configure({ nested: true })`) into the `extensions` array — they are in `package.json` today but never imported.
- **Parse/serialize:** `tiptap-markdown` parses via bundled `markdown-it-task-lists` and reuses `bulletList`'s serializer for `taskList`. **Deviation from plan:** that serializer emits a *loose* list (blank line between items) for taskList because — unlike bulletList — the taskList node has no `tight` attr, so it falls back to loose (and `Markdown.configure({tightLists})` doesn't reach it). Left as-is this silently double-spaces every checklist on the first edit-save. Fix: `MarkdownTaskList` (in `web/src/lib/markdownTaskList.ts`) adds a `tight` attr (default `true`, `rendered:false`) so the existing serializer emits a tight list matching bulletList — no serialize override needed (cleaner than 46-A's table override).
- **Optimistic UI:** clicking a checkbox updates the doc → `onUpdate` → `onChange` save path; the box flips immediately (Tiptap local state) and the save reconciles — no new handler.
- **CSS:** scoped `.contentInput ul[data-type="taskList"]` rules (element/attribute selectors, not CSS-Module-hashed) — no bullet, checkbox beside label, nested indent.
- **Tests:** `taskListMarkdownRoundTrip.test.ts` (checkbox render, checked-state preserved, tight flat + nested, blank lines around embedded list, idempotency); `NoteEditor.test.tsx` render + toggle gate (click pushes `[x]` to onChange).
- **Acceptance criteria:**
  - [x] `- [ ]` / `- [x]` render as unchecked/checked boxes, no literal brackets.
  - [x] Clicking a checkbox toggles it and the change reaches the save path immediately.
  - [x] Checked state round-trips through save + reopen.
  - [x] Nested task lists indent.

### 46-C
- **Events/commands / Projections / API:** none — frontend only.
- **Approach:** `tiptap-markdown` 0.9 exposes **no** markdown-it-plugin injection hook, so emoji is not a parser plugin here. Implement two paths, sharing one curated `:shortcode:` → unicode map:
  1. **Load path** — transform the incoming markdown string (replace known shortcodes with the glyph) before it reaches the editor (alongside the existing content pipeline in `NoteEditor.tsx`).
  2. **Type path** — a Tiptap `InputRule` that converts a completed `:shortcode:` to the glyph as the user types.
- **Serialization:** emoji persists as **unicode**, not the original shortcode (there is no reverse map) — an accepted, documented tradeoff; unicode → unicode is stable across round-trips.
- **Map source:** prefer a small curated common-set map to avoid a heavy dependency; if a library table is used (e.g. the data behind `markdown-it-emoji` / `node-emoji`), pin it and match the lockfile to CI's npm. Unknown codes pass through untouched.
- **Tests:** map converts known codes; leaves unknown codes verbatim; the input rule converts on completion; a round-trip keeps the glyph.
- **Acceptance criteria:**
  - [ ] A known `:shortcode:` in loaded content renders as its emoji.
  - [ ] An unknown `:shortcode:` is left unchanged.
  - [ ] Typing a known shortcode converts it live.

### Observability
- Frontend-only rendering; no server-side signal to add. The one silent failure mode is a parser edge case (a malformed table or task line) throwing and blanking the editor — guarded by the 46-A malformed-table test and covered in prod by the existing RUM JS-error capture. No new instrumentation code.

### Deploy-time
- Frontend-only (web asset); `backend=false`. **Neutral** deploy-time. No backend/route half → none of the "frontend-only route-contract" 404 traps apply (no API route moves). New table extension code sits behind the already-lazy `LazyNoteEditor` code-split, so no entry-bundle regression.

### Deferred out of this phase (routed elsewhere)
- **Footnotes** and **math (KaTeX)** — high-cost custom Tiptap nodes (no built-in node; need bespoke parse+serialize and are awkward to edit in a WYSIWYG), not free plugins as the source analysis assumed. **Definition lists** — same class (custom node) and niche. All three logged in [docs/future-features.md](../future-features.md) as "Advanced markdown". Decision (2026-07-01): defer.
- **Blockquote visual polish** and **image alt-text on load failure** — P2 CSS/small-tweak items, logged as CHANGE-30 / CHANGE-31 in [docs/phases/phase-minor-changes.md](phase-minor-changes.md).
