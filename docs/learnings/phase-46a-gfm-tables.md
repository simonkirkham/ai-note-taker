# Phase 46-A — GFM tables in the Tiptap note editor

**Slice:** render GFM pipe tables as a real grid in the note editor. Frontend-only. PR #381, deploy #686 (green on attempt 3 after two TI-42 cold-projector E2E flakes).

## What was non-obvious

### 1. `@tiptap/extension-table` v3 has no default export — the wrong import silently no-ops
`import Table from '@tiptap/extension-table'` gives `undefined` in v3. Passing `undefined` into the `extensions` array throws nothing — the node just never registers, so a table collapses to a run-on `<p>` exactly as if the extension were absent. Debugging looked like "tiptap-markdown can't parse tables" when the real cause was a dead import.

- **Fix:** use the **named** exports — `import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'`. The single package supplies all four nodes plus a `TableKit` bundle, so the separate `-row`/`-header`/`-cell` packages are unnecessary (they *do* have default exports, which is what makes the inconsistency easy to miss).
- **General rule:** when a Tiptap extension import resolves to `undefined`, it's a default-vs-named export mismatch, not a parse/schema problem. Probe `typeof Ext` before assuming the pipeline is broken.

### 2. tiptap-markdown's default table serializer silently drops column alignment
Parsed cells carry an `align` attr and render aligned (`text-align: …`), but tiptap-markdown serialises every separator as bare `| --- |`. Because `onUpdate` re-serialises the whole doc on **any** edit, the first keystroke in a note strips alignment from all its tables — a guaranteed, invisible-until-reload degradation, not an edge case.

- **Fix:** override only the `serialize` half of the table markdown spec. tiptap-markdown resolves a node's spec as `{...defaultSpec, ...extension.storage.markdown}` (`getMarkdownSpec`), so extending the node with `addStorage(){ return { markdown: { serialize } } }` replaces the serializer while **keeping the default markdown-it parser**. `MarkdownTable` reads each column's `align` and emits `:---`/`:---:`/`---:`.

### 3. The serializer bug Hawk caught — restore `state.closed`, not just `state.out`
To render a cell to a string, the serializer snapshots prosemirror-markdown's `state.out` buffer around `renderInline`, then rolls it back. But `renderInline → write → flushClose()` has a **second** side effect: it clears `state.closed` (the pending block-close from whatever preceded the table). Rolling back only `out` left `closed` null, so the first real table line swallowed the separator after the preceding block and **glued the table onto it** — invalid GFM that collapses to a run-on on reload (the very bug the slice fixes).

- **Fix:** snapshot and restore `state.closed` alongside `state.out`. Also set `state.inTable` so a hard break in a cell serialises as `<br>`, not a `\` continuation.
- **Test lesson:** every round-trip fixture was a *standalone* table, so all passed while the real bug (table-after-content) shipped. **A serializer test set must include the element in context** — paragraph→table, heading→table, table→content, back-to-back tables — not just the element alone.

## Process note
- Two E2E attempts red-gated deploy #686 on the cards-list projector ([TI-42], cold-projector/workspace-context-on-reload) — different journeys, both `cards(0)=[]`. Unrelated to this frontend slice; passed on attempt 3. Data point added to TI-42; the cold-start window that reproduces it is what [TI-52] (projector keep-warm) would remove.
