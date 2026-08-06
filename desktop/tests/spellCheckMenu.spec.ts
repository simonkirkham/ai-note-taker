import { test, expect } from '@playwright/test'
import { buildSpellCheckMenu, MAX_SUGGESTIONS, type SpellCheckParams } from '../src/spellCheckMenu'

// CHANGE-37 — the pure right-click spelling menu decision, unit-tested with no Electron
// and no real window, the same headless seam as displayMedia.spec.ts.
function params(over: Partial<SpellCheckParams> = {}): SpellCheckParams {
  return { isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'], ...over }
}

test('offers each suggestion as a replace action', () => {
  const menu = buildSpellCheckMenu(params())
  expect(menu).not.toBeNull()
  expect(menu!.slice(0, 2)).toEqual([
    { label: 'the', action: { kind: 'replace', word: 'the' } },
    { label: 'ten', action: { kind: 'replace', word: 'ten' } },
  ])
})

test('always offers Add to dictionary for the misspelled word', () => {
  const menu = buildSpellCheckMenu(params())
  expect(menu!.at(-1)).toEqual({ label: 'Add to dictionary', action: { kind: 'addToDictionary', word: 'teh' } })
})

test('a proper noun with no suggestions still offers Add to dictionary, and no separator', () => {
  const menu = buildSpellCheckMenu(params({ misspelledWord: 'Kirkham', dictionarySuggestions: [] }))
  expect(menu).toEqual([
    { label: 'Add to dictionary', action: { kind: 'addToDictionary', word: 'Kirkham' } },
  ])
})

test('caps the suggestion list', () => {
  const many = Array.from({ length: 20 }, (_, i) => `guess${i}`)
  const menu = buildSpellCheckMenu(params({ dictionarySuggestions: many }))
  const replacements = menu!.filter((i) => 'action' in i && i.action.kind === 'replace')
  expect(replacements).toHaveLength(MAX_SUGGESTIONS)
})

test('correctly-spelled word → no menu (today s behaviour is unchanged)', () => {
  expect(buildSpellCheckMenu(params({ misspelledWord: '', dictionarySuggestions: [] }))).toBeNull()
})

test('non-editable area → no menu even if a misspelling is reported', () => {
  expect(buildSpellCheckMenu(params({ isEditable: false }))).toBeNull()
})
