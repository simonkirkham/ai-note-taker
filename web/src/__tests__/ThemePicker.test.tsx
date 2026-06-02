import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemePicker from '../components/ThemePicker'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('ThemePicker', () => {
  it('defaults to Teal when nothing is stored, with no data-theme attribute', () => {
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('teal')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('selecting Forest applies data-theme="forest" and persists it', async () => {
    render(<ThemePicker />)
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'forest')
    expect(document.documentElement.dataset.theme).toBe('forest')
    expect(localStorage.getItem('note-taker-theme')).toBe('forest')
  })

  it('selecting Midnight applies data-theme="midnight"', async () => {
    render(<ThemePicker />)
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'midnight')
    expect(document.documentElement.dataset.theme).toBe('midnight')
    expect(localStorage.getItem('note-taker-theme')).toBe('midnight')
  })

  it('selecting Teal clears the data-theme attribute (back to :root default)', async () => {
    render(<ThemePicker />)
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'midnight')
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'teal')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('note-taker-theme')).toBe('teal')
  })

  it('restores a persisted theme on mount', () => {
    localStorage.setItem('note-taker-theme', 'midnight')
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('midnight')
  })

  it('keeps the selection across a remount', async () => {
    const { unmount } = render(<ThemePicker />)
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'forest')
    unmount()
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('forest')
  })

  it('falls back to Teal for an unrecognised stored value', () => {
    localStorage.setItem('note-taker-theme', 'banana')
    render(<ThemePicker />)
    expect(screen.getByLabelText('Theme')).toHaveValue('teal')
  })
})
