# Phase 7 Prototype — Reference

## Confirmed UX patterns

### Mark-as-discussed button
- Positioned **absolutely alongside the active heading**, not in a fixed toolbar row above the editor
- Tracks the heading's Y coordinate via `editor.view.coordsAtPos(from)` relative to the container element
- Fades in/out (`opacity` transition) when cursor enters/leaves a heading node
- Use `onMouseDown` + `e.preventDefault()` — prevents editor blur before toggle fires
- Label reads "✓ Mark as discussed" → "✓ Discussed" after toggle; teal fill when active
- Clicking again removes the strikethrough (full toggle)

### Heading prefix display
- `## ` prefix shown inline using CSS `::before` pseudo-elements on `h1`, `h2`, `h3`
- Muted grey (`#94A3B8`), normal weight — visually distinct from heading text
- Non-selectable and non-editable (pure CSS content, not DOM text); acceptable for this use case

### Keyboard shortcuts
| Shortcut | Effect |
|----------|--------|
| `Ctrl+1` / `# ` + Space | H1 heading |
| `Ctrl+2` / `## ` + Space | H2 heading (primary agenda topic) |
| `Ctrl+3` / `### ` + Space | H3 heading |
| `Ctrl+B` / `**text**` | Bold |
| `Ctrl+I` / `*text*` | Italic |
| `- ` + Space | Bullet list item |

`Ctrl+1/2/3` implemented via a custom `Extension.create` with `addKeyboardShortcuts` — StarterKit's built-in `Ctrl+Alt+1/2/3` is too awkward.

### Scope decision: topics stay embedded
Topics are H2 headings in the note body, not a separate entity. Carry-over of undiscussed topics is a future "copy undiscussed headings to new note" action — no separate Topic aggregate needed for Phase 7.

### Dropped: task list (7-B)
Checkbox/task-list slice removed. Mark-as-discussed on headings covers the meeting tracking need.

---

## TipTap v3 notes (version 3.23.4)

- `BubbleMenu` is **not** exported from `@tiptap/react` v3 — it lives in `@tiptap/extension-bubble-menu` as a DOM plugin, not a React component. Do not attempt to use it as a JSX component.
- `Extension` is exported directly from `@tiptap/react` in v3.
- `useEditorState` is the correct hook for reactively deriving state from the editor on every selection change.
- `tiptap-markdown` v0.9.0: TypeScript types don't expose `storage.markdown` — cast as `(editor.storage as any).markdown.getMarkdown()`.
- StarterKit v3 includes Strike; no separate import needed.

---

## Key component structure for real implementation

```
web/src/components/NoteEditor.tsx   — new component
  extensions: [StarterKit, Markdown, HeadingShortcuts]
  props: value: string, onChange: (md: string) => void, onBlur: () => void
  
  HeadingShortcuts — Extension.create with addKeyboardShortcuts (Mod-1/2/3)
  
  Floating ✓ button:
    - container: position: relative wrapper around EditorContent
    - button: position: absolute, right: outside-editor, top from coordsAtPos
    - visibility gated on useEditorState({ selector: e => e.isActive('heading') })
    - onMouseDown + preventDefault to avoid blur race

  CSS (scoped to .note-editor class):
    h1::before { content: "# ";   color: muted }
    h2::before { content: "## ";  color: muted }
    h3::before { content: "### "; color: muted }

web/src/components/NoteView.tsx     — replace <textarea> with <NoteEditor>
src/Api/Handlers/NoteHandlers.cs    — StripMarkdown before contentPreview truncation
```
