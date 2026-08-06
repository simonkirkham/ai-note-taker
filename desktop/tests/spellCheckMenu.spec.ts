import { test, expect } from '@playwright/test'
import { buildSpellCheckMenu, MAX_SUGGESTIONS, type SpellCheckParams } from '../src/spellCheckMenu'

// CHANGE-37 — the pure right-click spelling menu decision, unit-tested with no Electron
// and no real window, the same headless seam as displayMedia.spec.ts.
function params(over: Partial<SpellCheckParams> = {}): SpellCheckParams {
  return { isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'], ...over }
}

// Asserts the WHOLE array, not slices. Partial assertions let a missing separator (or a
// spurious extra item) through — proven by mutation: dropping the separator push left every
// slice-based assertion green.
test('full menu: each suggestion, a separator, then Add to dictionary', () => {
  expect(buildSpellCheckMenu(params())).toEqual([
    { label: 'the', action: { kind: 'replace', word: 'the' } },
    { label: 'ten', action: { kind: 'replace', word: 'ten' } },
    { separator: true },
    { label: 'Add to dictionary', action: { kind: 'addToDictionary', word: 'teh' } },
  ])
})

test('a proper noun with no suggestions still offers Add to dictionary, and no separator', () => {
  const menu = buildSpellCheckMenu(params({ misspelledWord: 'Kirkham', dictionarySuggestions: [] }))
  expect(menu).toEqual([
    { label: 'Add to dictionary', action: { kind: 'addToDictionary', word: 'Kirkham' } },
  ])
})

// Asserts the literal 6, not MAX_SUGGESTIONS — asserting the imported constant is
// self-referential, so changing the cap would leave the test green.
test('caps the suggestion list at 6', () => {
  const many = Array.from({ length: 20 }, (_, i) => `guess${i}`)
  const menu = buildSpellCheckMenu(params({ dictionarySuggestions: many }))
  const replacements = menu!.filter((i) => 'action' in i && i.action.kind === 'replace')
  expect(replacements).toHaveLength(6)
  expect(MAX_SUGGESTIONS).toBe(6)
})

test('correctly-spelled word → no menu (today s behaviour is unchanged)', () => {
  expect(buildSpellCheckMenu(params({ misspelledWord: '', dictionarySuggestions: [] }))).toBeNull()
})

test('non-editable area → no menu even if a misspelling is reported', () => {
  expect(buildSpellCheckMenu(params({ isEditable: false }))).toBeNull()
})
