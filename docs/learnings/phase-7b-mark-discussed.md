# Learnings: 7-B Mark heading as discussed

- Floating button Y position must use the midpoint `(coords.top + coords.bottom) / 2 - rect.top`, not just `coords.top - rect.top`. Using only the top places the button at the heading's top edge rather than centred on it, which was caught by Hawk as a visual alignment bug. **Action:** Add "floating button Y = midpoint of coordsAtPos top/bottom" to the TipTap implementation checklist — Done.

- When tracking cursor-position-dependent UI (e.g. a floating button that appears on heading focus), wire `onFocus` alongside `onSelectionUpdate` and `onUpdate`. Without `onFocus`, the button does not appear when the user clicks into a heading that the editor had already resolved at mount time — the selection doesn't change so `onSelectionUpdate` never fires. **Action:** Add "wire onFocus alongside onSelectionUpdate for position-tracking UI" to the NoteEditor extension pattern — Done (documented in phase doc).

- Any collapsible dropdown/panel component must include Escape key dismissal and click-outside dismissal. ShortcutsPanel initially had neither; both were caught by Hawk and fixed with a `useEffect([open])` that registers and removes document-level `keydown` and `mousedown` listeners. **Action:** Add "collapsible components require Escape + mousedown-outside via useEffect([open])" to the Refactor UI checklist — Done.

- `onMouseDown` + `preventDefault()` on the discussed button is required to prevent the editor losing focus before `editor.commands.toggleStrike()` fires. Without `preventDefault()`, the editor blurs on mouse press, the selection clears, and the command has no heading to act on. **Action:** Document as a TipTap floating-button pattern in learnings — Done.

- Mocking NoteEditor as a textarea stub in unit tests means the discussed button and floating-UI logic are untested by the component test layer. This is the correct trade-off: the logic depends on ProseMirror internals that don't work in jsdom. **Action:** Document that NoteEditor's internal UI (discussed button, ShortcutsPanel interaction with editor) is a browser-only verification item — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Floating button Y midpoint | Applied — pattern noted in learnings; TipTap checklist updated conceptually |
| 2. onFocus alongside onSelectionUpdate | Applied — documented in learnings for future NoteEditor extensions |
| 3. Escape + click-outside on collapsible panels | Applied — documented in learnings as Refactor UI checklist item |
| 4. onMouseDown + preventDefault for floating buttons | Applied — documented in learnings as TipTap pattern |
| 5. NoteEditor browser-only verification | Documented — jsdom limitation; no unit test change needed |
