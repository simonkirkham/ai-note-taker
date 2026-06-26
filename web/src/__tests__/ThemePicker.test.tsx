import userEvent from '@testing-library/user-event'
import ThemePicker from '../components/ThemePicker'
import { render, screen } from '../test/render'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

// Teal stays on :root (no data-theme). Light + dark themes offered beyond Teal.
// The old CHANGE-7 'forest' remains removed (a new dark green ships as 'pine').
const LIGHT_THEMES = ['indigo', 'rose', 'amber', 'violet', 'sky', 'sepia', 'contrast', 'emerald', 'fuchsia', 'lime']
const DARK_THEMES = ['midnight', 'slate', 'carbon', 'plum', 'pine', 'ocean', 'ember']
const NEW_THEMES = [...LIGHT_THEMES, ...DARK_THEMES]

describe('ThemePicker', () => {
  it('defaults to Teal when nothing is stored, with no data-theme attribute', () => {
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('teal')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('no longer offers Forest, and offers Teal plus every new theme', () => {
    render(<ThemePicker />)
    const values = Array.from(
      screen.getByLabelText('Theme').querySelectorAll('option'),
    ).map((o) => o.value)
    expect(values).not.toContain('forest')
    expect(values).toContain('teal')
    for (const t of NEW_THEMES) {
      expect(values).toContain(t)
    }
  })

  it.each(NEW_THEMES)(
    'selecting %s applies its data-theme and persists it',
    async (themeKey) => {
      render(<ThemePicker />)
      await userEvent.selectOptions(screen.getByLabelText('Theme'), themeKey)
      expect(document.documentElement.dataset.theme).toBe(themeKey)
      expect(localStorage.getItem('note-taker-theme')).toBe(themeKey)
    },
  )

  it('selecting Teal clears the data-theme attribute (back to :root default)', async () => {
    render(<ThemePicker />)
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'midnight')
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'teal')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('note-taker-theme')).toBe('teal')
  })

  it('restores a persisted theme on mount', () => {
    localStorage.setItem('note-taker-theme', 'violet')
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('violet')
  })

  it('keeps the selection across a remount', async () => {
    const { unmount } = render(<ThemePicker />)
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'sepia')
    unmount()
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('sepia')
  })

  it('falls back to Teal for an unrecognised stored value', () => {
    localStorage.setItem('note-taker-theme', 'banana')
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('teal')
  })

  it('falls back to Teal for a previously-saved, now-removed Forest value', () => {
    localStorage.setItem('note-taker-theme', 'forest')
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('teal')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
