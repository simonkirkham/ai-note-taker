# Phase 8 — Rich note content

**Goal:** Replace the plain textarea with a WYSIWYG editor that lets users structure meeting notes using headings, bold, bullet lists, and checkboxes — all via keyboard shortcuts. Headings double as agenda topics; a single click marks a topic as discussed (strikethrough).

**Learning surface:** Integrating a ProseMirror-based editor (TipTap) into a React component; markdown as a storage format for structured content; server-side content transformation (markdown stripping for preview text); the difference between editor-internal state and persisted state.

---

## What needs to change

| Area | Change |
|------|--------|
| `web/src/components/NoteView.tsx` | Replace `<textarea>` with `<NoteEditor>` component |
| `web/src/components/NoteEditor.tsx` | New TipTap editor component (new file) |
| `web/package.json` | Add TipTap packages |
| `src/Api/Handlers/NoteHandlers.cs` | Strip markdown syntax before truncating `contentPreview` |

No new events, no new projections, no CDK changes, no new API endpoints.

---

## Slice order and dependencies

```
8-A  Base editor (headings, bold, bullets) + markdown storage + stripped preview
8-B  Task list (checkboxes) support                            (depends 8-A)
8-C  Mark-as-discussed on headings                             (depends 8-B)
```

---

## Slice 8-A — Base editor, markdown storage, stripped preview

**Status:** Not Started

**Value:** The textarea is gone. The editor renders existing markdown content correctly and saves it back as markdown on blur. Headings, bold, and bullet lists work via keyboard shortcuts. The NoteCard snippet shows plain text, not raw markdown syntax.

**Changes in scope:**

- `web/package.json`: add `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, and a markdown serialisation package (see implementation note below)
- `web/src/components/NoteEditor.tsx`: new component wrapping `useEditor` from `@tiptap/react`; exposes `value: string` (markdown) and `onChange: (md: string) => void`; saves on blur via `onBlur` prop
- `web/src/components/NoteView.tsx`: import `NoteEditor`; replace `<textarea>` with `<NoteEditor value={content} onChange={setContent} onBlur={() => editContent(noteId, content)} />`
- `src/Api/Handlers/NoteHandlers.cs`: strip common markdown tokens from `c.Content` before truncating to `MaxPreviewLength`

**Keyboard shortcuts (provided by StarterKit defaults):**

| Keys | Effect |
|------|--------|
| `#` + Space | H1 heading |
| `##` + Space | H2 heading (primary topic marker) |
| `###` + Space | H3 heading |
| `**text**` | Bold |
| `-` + Space | Bullet list item |
| Enter | New list item / new paragraph |
| Backspace at start of list item | Lift out of list |

**Markdown serialisation implementation note:**

TipTap stores content as a ProseMirror JSON document internally. For persistence, content must be converted to/from a markdown string. Two options:

- `@tiptap/extension-markdown` (official, experimental) — simplest integration
- `tiptap-markdown` (community, well-maintained) — more complete markdown support

Use `@tiptap/extension-markdown` first; switch to `tiptap-markdown` if task list or strikethrough serialisation gaps appear during testing.

**Markdown stripping in preview (server-side):**

In `NoteHandlers.cs`, apply a simple transformation before truncation:

```csharp
private static string StripMarkdown(string content)
{
    var s = content;
    s = Regex.Replace(s, @"^#{1,6}\s*", "", RegexOptions.Multiline);   // headings
    s = Regex.Replace(s, @"~~(.+?)~~", "$1");                           // strikethrough
    s = Regex.Replace(s, @"\*\*(.+?)\*\*", "$1");                      // bold
    s = Regex.Replace(s, @"\*(.+?)\*", "$1");                          // italic
    s = Regex.Replace(s, @"^\s*-\s+\[[ x]\]\s*", "", RegexOptions.Multiline); // task items
    s = Regex.Replace(s, @"^\s*[-*]\s+", "", RegexOptions.Multiline);  // bullet items
    return s.Trim();
}
```

Call before truncation: `var preview = StripMarkdown(c.Content)...`

**Scenarios:**

```
Scenario: Heading shortcut creates a heading
  Given the editor is focused
  When  the user types "## " followed by "Budget review"
  Then  the text "Budget review" is rendered as an H2 heading

Scenario: Bold shortcut bolds text
  Given the editor contains "agreed"
  When  the user selects "agreed" and presses Ctrl+B
  Then  "agreed" is rendered bold

Scenario: Bullet list shortcut creates a list
  Given the editor is focused
  When  the user types "- " followed by "First item"
  Then  "First item" appears as a bullet list item

Scenario: Content is saved as markdown on blur
  Given the editor contains an H2 heading "Hiring plan" and a bullet "2 seniors"
  When  the editor loses focus
  Then  ContentEditedV2 is fired with content "## Hiring plan\n- 2 seniors"

Scenario: Existing markdown content loads correctly
  Given a note with content "## Topic\n\nSome notes"
  When  the note is opened
  Then  "Topic" is rendered as an H2 heading and "Some notes" as a paragraph

Scenario: NoteCard snippet shows plain text
  Given a note with content "## Budget review\n**agreed** £50k cap"
  When  the home screen is viewed
  Then  the snippet reads "Budget review\nagreed £50k cap" (no markdown tokens)
```

**Acceptance criteria:**

- [ ] `web/` builds without TypeScript errors (`npm run build`)
- [ ] `npm run lint` passes
- [ ] `dotnet test tests/ApiIntegration/ApiIntegration.csproj` — all green
- [ ] `dotnet test tests/Specs/Specs.csproj` — all green
- [ ] Heading (`##`), bold (`Ctrl+B`), and bullet (`-`) shortcuts work in the browser
- [ ] Content round-trips correctly: open a note, type formatted content, blur, re-open — formatting persists
- [ ] NoteCard snippet contains no `##`, `**`, or `-` tokens

---

## Slice 8-B — Task list (checkboxes)

**Status:** Not Started

**Value:** Users can create checkbox items in the note body using `- [ ]` syntax. Ticking a checkbox fires `ContentEditedV2` with the updated markdown.

**Changes in scope:**

- `web/package.json`: add `@tiptap/extension-task-list` and `@tiptap/extension-task-item`
- `web/src/components/NoteEditor.tsx`: add `TaskList` and `TaskItem` extensions; configure `TaskItem` with `nested: false`; checkbox toggle fires the `onChange` callback

**Keyboard shortcut:**

| Keys | Effect |
|------|--------|
| `- [ ]` + Space | Checkbox item (unchecked) |
| Click checkbox | Toggle checked/unchecked; triggers onChange → save |

**Scenarios:**

```
Scenario: Checkbox item shortcut creates an unchecked item
  Given the editor is focused
  When  the user types "- [ ] " followed by "Follow up with finance"
  Then  an unchecked checkbox item "Follow up with finance" appears

Scenario: Ticking a checkbox saves the updated markdown
  Given the note contains "- [ ] Follow up with finance"
  When  the user clicks the checkbox
  Then  ContentEditedV2 is fired with "- [x] Follow up with finance"

Scenario: Checked items persist on reload
  Given a note with content "- [x] Follow up with finance"
  When  the note is opened
  Then  the checkbox item "Follow up with finance" appears checked
```

**Acceptance criteria:**

- [ ] `- [ ]` shortcut creates a checkbox item
- [ ] Clicking a checkbox fires `ContentEditedV2` with the updated markdown
- [ ] Checked state persists after closing and reopening the note
- [ ] `npm run build` and `npm run lint` pass

---

## Slice 8-C — Mark topic as discussed

**Status:** Not Started

**Value:** Users can mark a heading (agenda topic) as discussed during a meeting. A ✓ button appears when the cursor is inside a heading; clicking it applies strikethrough to the heading text and saves the updated markdown (`## ~~Topic~~`). Clicking again removes it.

**Changes in scope:**

- `web/src/components/NoteEditor.tsx`: extend with `Strike` extension (from StarterKit or standalone); add a ✓ button that appears when the current selection is inside a heading node; toggle calls `editor.commands.toggleStrike()` and triggers `onChange`

**Implementation note:**

The ✓ button can be implemented as a React element rendered conditionally based on `editor.isActive('heading')`. A fixed toolbar row appearing when the cursor is in a heading is simpler than a NodeView and avoids absolute positioning complexity.

Verify that the markdown extension correctly round-trips `## ~~text~~`. If not, fall back to `## ✓ Topic name` and update `StripMarkdown` to strip the `✓ ` prefix.

**Scenarios:**

```
Scenario: Discussed button appears when cursor is in a heading
  Given the editor contains "## Budget review" as an H2 heading
  When  the user clicks into the heading text
  Then  a ✓ button is visible

Scenario: Clicking ✓ marks the heading as discussed
  Given the cursor is inside the "## Budget review" heading
  When  the user clicks the ✓ button
  Then  "Budget review" renders with strikethrough
  And   ContentEditedV2 is fired with "## ~~Budget review~~"

Scenario: Clicking ✓ again removes the discussed mark
  Given the heading "## ~~Budget review~~" is marked discussed
  When  the user clicks the ✓ button
  Then  the strikethrough is removed
  And   ContentEditedV2 is fired with "## Budget review"

Scenario: Discussed state persists on reload
  Given a note with content "## ~~Budget review~~"
  When  the note is opened
  Then  "Budget review" is rendered as a heading with strikethrough

Scenario: NoteCard snippet strips strikethrough from discussed topics
  Given a note with content "## ~~Budget review~~\nSome notes"
  When  the home screen is viewed
  Then  the snippet reads "Budget review\nSome notes"
```

**Acceptance criteria:**

- [ ] ✓ button appears only when cursor is inside a heading
- [ ] Toggle applies/removes strikethrough on heading text
- [ ] Discussed heading persists correctly after close/reopen
- [ ] `StripMarkdown` in `NoteHandlers.cs` strips `~~` tokens from the preview
- [ ] `npm run build` and `npm run lint` pass
