# Phase 7 — Rich note content

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
7-A  Base editor (headings, bold, bullets) + markdown storage + stripped preview
7-B  Mark-as-discussed on headings                             (depends 7-A)
```

> **Dropped:** Task list (checkboxes) removed — heading mark-as-discussed covers the meeting tracking need without the added complexity of a separate checkbox extension.

---

## Slice 7-A — Base editor, markdown storage, stripped preview

**Status:** Done

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

- [x] `web/` builds without TypeScript errors (`npm run build`)
- [x] `npm run lint` passes
- [x] `dotnet test tests/Api.Integration/Api.Integration.csproj` — all green (102 tests)
- [x] `dotnet test tests/Domain.Specs/Domain.Specs.csproj` — all green (110 tests)
- [ ] Heading (`##`), bold (`Ctrl+B`), and bullet (`-`) shortcuts work in the browser
- [ ] Content round-trips correctly: open a note, type formatted content, blur, re-open — formatting persists
- [x] NoteCard snippet contains no `##`, `**`, or `-` tokens (covered by 6 API integration tests)

---

## Slice 7-B — Mark topic as discussed

**Status:** Not Started

**Value:** Users can mark a heading (agenda topic) as discussed during a meeting. A ✓ button appears when the cursor is inside a heading; clicking it applies strikethrough to the heading text and saves the updated markdown (`## ~~Topic~~`). Clicking again removes it.

**Changes in scope:**

- `web/src/components/NoteEditor.tsx`: extend with `Strike` extension (from StarterKit or standalone); add a ✓ button that appears when the current selection is inside a heading node; toggle calls `editor.commands.toggleStrike()` and triggers `onChange`

**Implementation note:**

The ✓ button is positioned absolutely alongside the active heading using `editor.view.coordsAtPos()` to track its Y coordinate — confirmed in prototype as the preferred UX over a fixed toolbar row. Use `onMouseDown` + `preventDefault()` on the button to prevent the editor losing focus before the toggle fires.

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
