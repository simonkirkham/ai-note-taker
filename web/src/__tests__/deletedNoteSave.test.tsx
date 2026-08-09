import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { keys } from '../api/queryKeys'
import DeletedNoteRescue from '../components/DeletedNoteRescue'
import NoteView from '../components/NoteView'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

// BUG-59: a save into a note that has been DELETED 404s, and `handleSaveContent` routed every
// non-StaleContentError failure to the generic retriable toast — "Couldn't save your note. We kept
// your text — try again." That retry can never succeed. Prod evidence: note b721c995…, deleted at
// 14:34:21, then six rejected writes over the following 31 minutes.
//
// Attempt 1 (PR #439) fixed the message and nothing else. These tests exist because of what it
// missed, so each one names the failure mode it pins rather than the code path it walks:
//   - leaving the note is the COMMONEST exit and unmounts the component before the 404 lands
//   - any keys.note invalidation evicts component state
//   - the doomed writes have to actually stop
//   - a bare 404 is not evidence of deletion

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

const detail = {
  noteId: 'note-1',
  title: 'Doomed note',
  content: 'original body',
  date: null,
  tags: [],
}

function deletedResponse() {
  return HttpResponse.json({ error: 'note_not_found' }, { status: 404 })
}

// Mirrors App.tsx: the rescue banner is a SIBLING of the note screen, not a child of it, so
// unmounting the note cannot take it away. `onBack` unmounts NoteView exactly as navigating home
// does — the path attempt 1 went silent on.
function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <ToastProvider>
      <DeletedNoteRescue />
      {open && (
        <NoteView
          noteId="note-1"
          initialTitle="Doomed note"
          onBack={() => setOpen(false)}
          onDelete={asyncNoop}
          onDateSet={noop}
          onOpenNote={noop}
        />
      )}
    </ToastProvider>
  )
}

async function typeInto(text: string) {
  const editor = await screen.findByLabelText('Note content')
  await userEvent.click(editor)
  await userEvent.keyboard(text)
  return editor
}

describe('saving into a deleted note (BUG-59)', () => {
  it('hands the typed text back instead of inviting a retry that cannot succeed', async () => {
    server.use(
      http.get('/api/notes/:noteId', () => HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => deletedResponse()),
    )

    render(<Harness />)
    await typeInto(' plus some new text')
    await userEvent.tab() // blur flushes the draft through handleSaveContent

    expect(await screen.findByTestId('deleted-note-banner')).toBeInTheDocument()
    expect(screen.getByTestId('deleted-note-text')).toHaveDisplayValue(/plus some new text/)
    await waitFor(() => expect(screen.queryByText(/try again/i)).toBeNull())
  })

  // C1 — the regression attempt 1 introduced. `handleBack` fires the save and navigates in the same
  // tick, so the 404 resolves against an unmounted component. Held in component state the rescue is
  // a no-op and the user is told NOTHING, which is worse than the misleading toast it replaced.
  it('still surfaces the text when the user leaves the note before the save fails', async () => {
    server.use(
      http.get('/api/notes/:noteId', () => HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => deletedResponse()),
    )

    render(<Harness />)
    await typeInto(' text typed just before leaving')
    await userEvent.click(screen.getByTestId('save-button'))

    // The note screen is gone — this is the state attempt 1 could not report from.
    await waitFor(() => expect(screen.queryByLabelText('Note content')).toBeNull())
    expect(await screen.findByTestId('deleted-note-banner')).toBeInTheDocument()
    expect(screen.getByTestId('deleted-note-text')).toHaveDisplayValue(/text typed just before leaving/)
  })

  // C2 — the rescued text must not be evictable by a cache invalidation. useAnalyseNote.onSettled,
  // refreshNote and useTagMutations all invalidate keys.note, and any of them bounced attempt 1's
  // banner home and destroyed the text with it.
  it('keeps the rescued text across a note-cache invalidation', async () => {
    server.use(
      http.get('/api/notes/:noteId', () => HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => deletedResponse()),
    )

    const { queryClient } = render(<Harness />)
    await typeInto(' text that must survive')
    await userEvent.tab()
    await screen.findByTestId('deleted-note-banner')

    await queryClient.invalidateQueries({ queryKey: keys.note('note-1') })

    expect(screen.getByTestId('deleted-note-banner')).toBeInTheDocument()
    expect(screen.getByTestId('deleted-note-text')).toHaveDisplayValue(/text that must survive/)
  })

  // I2 — the 31-minute prod signature was repeat writes, not the toast. Attempt 1 restored the draft
  // ref on the 404, so every later blur and the unmount flush re-fired the same doomed PUT.
  it('stops writing to the note once it is known to be deleted', async () => {
    let writes = 0
    server.use(
      http.get('/api/notes/:noteId', () => HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => {
        writes += 1
        return deletedResponse()
      }),
    )

    render(<Harness />)
    await typeInto(' first edit')
    await userEvent.tab()
    await screen.findByTestId('deleted-note-banner')

    await typeInto(' second edit')
    await userEvent.tab()
    // ...and the leave flush, the other path that re-fired it.
    await userEvent.click(screen.getByTestId('save-button'))
    await waitFor(() => expect(screen.queryByLabelText('Note content')).toBeNull())

    expect(writes).toBe(1)
  })

  // I3 — a bare 404 is also what the ownership pre-check returns and what an API Gateway route miss
  // returns (34-B shipped one). Under a deploy skew, treating those as deletion would tell every
  // user their note had been deleted.
  it('does not claim deletion on a bare 404 with no discriminating body', async () => {
    server.use(
      http.get('/api/notes/:noteId', () => HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => new HttpResponse(null, { status: 404 })),
    )

    render(<Harness />)
    await typeInto(' some text')
    await userEvent.tab()

    expect(await screen.findByText(/try again/i)).toBeInTheDocument()
    expect(screen.queryByTestId('deleted-note-banner')).toBeNull()
  })

  it('still shows the retriable toast for a genuine transient failure', async () => {
    server.use(
      http.get('/api/notes/:noteId', () => HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => new HttpResponse(null, { status: 500 })),
    )

    render(<Harness />)
    await typeInto(' some text')
    await userEvent.tab()

    expect(await screen.findByText(/try again/i)).toBeInTheDocument()
    expect(screen.queryByTestId('deleted-note-banner')).toBeNull()
  })

  it('dismisses the banner on request', async () => {
    server.use(
      http.get('/api/notes/:noteId', () => HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => deletedResponse()),
    )

    render(<Harness />)
    await typeInto(' some text')
    await userEvent.tab()
    await screen.findByTestId('deleted-note-banner')

    await userEvent.click(screen.getByTestId('dismiss-deleted-note'))

    expect(screen.queryByTestId('deleted-note-banner')).toBeNull()
  })
})
