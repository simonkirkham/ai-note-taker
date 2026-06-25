# Phase 7 — Rich note content

**Goal:** Replace the plain textarea with a WYSIWYG editor that lets users structure meeting notes using headings, bold, bullet lists, and checkboxes — all via keyboard shortcuts. Headings double as agenda topics; a single click marks a topic as discussed (strikethrough).

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 7-A | Base editor, markdown storage, stripped preview | Done | — |
| 7-B | Mark topic as discussed | Done | 7-A |

> **Dropped:** Task list (checkboxes) removed — heading mark-as-discussed covers the meeting tracking need without the added complexity of a separate checkbox extension.

---

## Slice 7-A — Base editor, markdown storage, stripped preview

**Status:** Done

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

**Status:** Done

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

- [x] ✓ button appears only when cursor is inside a heading
- [x] Toggle applies/removes strikethrough on heading text
- [x] Discussed heading persists correctly after close/reopen
- [x] `StripMarkdown` in `NoteHandlers.cs` strips `~~` tokens from the preview
- [x] Shortcuts panel is collapsed by default; `?` button expands it to show all shortcuts
- [x] Panel lists: `##`/`###` headings, `**bold**`, `- bullet`, `Ctrl+B` toggle, ✓ mark discussed
- [x] `npm run build` and `npm run lint` pass
