import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// recordRumEvent is the gap 19-I1 closes for a failed lazy import — spy on it.
const recordRumEvent = vi.fn()
vi.mock('../rum', () => ({
  recordRumEvent: (type: string, data: Record<string, unknown>) => recordRumEvent(type, data),
}))

const editorProps = {
  noteId: 'note-1',
  value: '',
  onChange: () => {},
  onBlur: () => {},
}

describe('LazyNoteEditor', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    recordRumEvent.mockClear()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    vi.resetModules()
    vi.doUnmock('../components/NoteEditor')
  })

  it('shows a reserved-space fallback while the editor chunk loads, then the editor', async () => {
    vi.doMock('../components/NoteEditor', () => ({
      default: ({ value }: { value: string }) => (
        <textarea aria-label="Note content" data-testid="note-content" defaultValue={value} />
      ),
    }))
    const { default: LazyNoteEditor } = await import('../components/LazyNoteEditor')

    render(<LazyNoteEditor {...editorProps} />)

    // First paint: the editor chunk has not resolved yet, so the sized fallback shows.
    expect(screen.getByTestId('editor-loading')).toBeInTheDocument()

    // Once the chunk resolves, the editor replaces the fallback.
    expect(await screen.findByTestId('note-content')).toBeInTheDocument()
    expect(screen.queryByTestId('editor-loading')).not.toBeInTheDocument()
  })

  it('reserves a non-trivial min-height on the fallback to avoid layout shift', async () => {
    vi.doMock('../components/NoteEditor', () => ({
      default: () => <div data-testid="note-content" />,
    }))
    const { default: LazyNoteEditor } = await import('../components/LazyNoteEditor')

    render(<LazyNoteEditor {...editorProps} />)

    const fallback = screen.getByTestId('editor-loading')
    // The fallback must reserve vertical space (CLS ≤ 0.1) — a min-height is set.
    expect(fallback.style.minHeight).not.toBe('')
  })

  it('degrades a failed editor-chunk import to an error fallback and records a RUM event', async () => {
    vi.doMock('../components/NoteEditor', () => {
      throw new Error('Failed to fetch dynamically imported module: /assets/NoteEditor-abc.js')
    })
    const { default: LazyNoteEditor } = await import('../components/LazyNoteEditor')

    render(<LazyNoteEditor {...editorProps} />)

    // Not a blank pane: a recoverable error fallback is shown.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // The previously-invisible failure is now reported to RUM.
    expect(recordRumEvent).toHaveBeenCalledWith('lazyChunkError', expect.objectContaining({ component: 'NoteEditor' }))
  })
})
