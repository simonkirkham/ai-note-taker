import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import NoteView from '../components/NoteView'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

// BUG-59: a save into a note that has been DELETED 404s, and `handleSaveContent` routed every
// non-StaleContentError failure to the generic retriable toast — "Couldn't save your note. We kept
// your text — try again." That retry can never succeed. Prod evidence: note b721c995…, deleted at
// 14:34:21, then six rejected writes over the following 31 minutes.
//
// A 404 on a note write is TERMINAL, not transient. It must stop inviting a retry and hand the kept
// text back — the typed text lives only in this tab, so losing it (to a bounce to "Note not found",
// or to the user giving up and closing the tab) is the actual harm.

// Same stand-in as NoteView.test.tsx: NoteView renders the editor through LazyNoteEditor
// (React.lazy + Suspense), so mock that wrapper to keep this spec free of Suspense timing.
vi.mock('../components/LazyNoteEditor', () => ({
  default: ({ value, onChange, onBlur }: { value: string; onChange: (md: string) => void; onBlur: () => void }) => (
    <textarea
      aria-label="Note content"
      data-testid="note-content"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  ),
}))

const noop = () => {}
const asyncNoop = async () => {}

function renderNoteView() {
  return render(
    <ToastProvider>
      <NoteView
        noteId="note-1"
        initialTitle="Doomed note"
        onBack={noop}
        onDelete={asyncNoop}
        onDateSet={noop}
        onOpenNote={noop}
      />
    </ToastProvider>,
  )
}

describe('saving into a deleted note (BUG-59)', () => {
  it('shows a terminal deleted-note state that keeps the text, not a retry toast', async () => {
    server.use(
      http.get('/api/notes/:noteId', () =>
        HttpResponse.json({ noteId: 'note-1', title: 'Doomed note', content: 'original body', date: null, tags: [] })),
      // The note was deleted in another tab — every write against it is now terminal.
      http.put('/api/notes/:noteId/content', () => new HttpResponse(null, { status: 404 })),
    )

    renderNoteView()

    const editor = await screen.findByLabelText('Note content')
    await userEvent.click(editor)
    await userEvent.keyboard(' plus some new text')
    // Blur flushes the draft through handleSaveContent — the path that 404s.
    await userEvent.tab()

    expect(await screen.findByTestId('deleted-note-banner')).toBeInTheDocument()
    // The typed text is handed back for recovery, not dropped.
    expect(screen.getByTestId('deleted-note-text')).toHaveDisplayValue(/plus some new text/)
    // ...and NOT the "try again" toast, which invites a retry that cannot succeed.
    await waitFor(() => expect(screen.queryByText(/try again/i)).toBeNull())
  })

  it('still shows the retriable toast for a genuine transient failure', async () => {
    server.use(
      http.get('/api/notes/:noteId', () =>
        HttpResponse.json({ noteId: 'note-1', title: 'Fine note', content: 'body', date: null, tags: [] })),
      http.put('/api/notes/:noteId/content', () => new HttpResponse(null, { status: 500 })),
    )

    renderNoteView()

    const editor = await screen.findByLabelText('Note content')
    await userEvent.click(editor)
    await userEvent.keyboard(' more')
    await userEvent.tab()

    expect(await screen.findByText(/try again/i)).toBeInTheDocument()
    expect(screen.queryByTestId('deleted-note-banner')).toBeNull()
  })
})
