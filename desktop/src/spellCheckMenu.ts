// CHANGE-37 — right-click spelling corrections in the desktop shell.
// Electron ships NO default context menu, so right-clicking a misspelled word offered
// nothing even though the spellchecker was already underlining it. Kept pure (no electron
// import) so the menu shape is unit-testable headlessly; main.ts turns the descriptor into
// a real Menu and performs the actions.

export type SpellCheckAction =
  // Replace the misspelled word with this suggestion (webContents.replaceMisspelling).
  | { kind: 'replace'; word: string }
  // Teach the dictionary (session.addWordToSpellCheckerDictionary), so it stops being flagged.
  | { kind: 'addToDictionary'; word: string }

export type SpellCheckMenuItem = { label: string; action: SpellCheckAction } | { separator: true }

// The subset of Electron's ContextMenuParams this decision needs.
export type SpellCheckParams = {
  isEditable: boolean
  misspelledWord: string
  dictionarySuggestions: string[]
}

// Cap the suggestions offered. Chromium can return a long tail of low-confidence guesses,
// and a menu longer than this is harder to scan than retyping the word.
export const MAX_SUGGESTIONS = 6

// Returns the menu to show, or null to show none at all. Null is the common case — a
// right-click on correctly-spelled text, or in a non-editable area, must keep today's
// behaviour (no menu) rather than popping an empty one.
export function buildSpellCheckMenu(params: SpellCheckParams): SpellCheckMenuItem[] | null {
  if (!params.isEditable) return null
  const word = params.misspelledWord
  if (!word) return null

  const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS)
  const items: SpellCheckMenuItem[] = suggestions.map((s) => ({
    label: s,
    action: { kind: 'replace', word: s },
  }))

  // "Add to dictionary" is offered even with no suggestions — a proper noun (a client or
  // product name, the tags this app is built around) is exactly the case where Chromium
  // has nothing to suggest and teaching it is the only useful action.
  if (items.length > 0) items.push({ separator: true })
  items.push({ label: 'Add to dictionary', action: { kind: 'addToDictionary', word } })

  return items
}
