import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { keys } from '../api/queryKeys'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { useAuth } from '../auth/context'
import DeletedNoteRescue from '../components/DeletedNoteRescue'
import NoteView from '../components/NoteView'
import { ToastProvider } from '../components/ToastProvider'
import { reportDeletedNote } from '../lib/deletedNoteRescue'
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
function Harness({ onNotFound }: { onNotFound?: () => void } = {}) {
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
          onNotFound={onNotFound}
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

  // Review of this redesign: deleting the `invalidateQueries` call left all seven tests green, even
  // though "invalidate, so the existing is404 path takes the user home" is half the stated design.
  // The old harness stubbed GET as 200-forever, so no test could ever observe the refetch. This one
  // flips the GET to 404 the moment the note is deleted, which is what the server actually does.
  it('takes the user off the dead note, and the rescued text outlives that', async () => {
    let deleted = false
    const onNotFound = vi.fn()
    server.use(
      http.get('/api/notes/:noteId', () =>
        deleted
          ? HttpResponse.json({ error: 'note_not_found' }, { status: 404 })
          : HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => {
        deleted = true
        return deletedResponse()
      }),
    )

    render(<Harness onNotFound={onNotFound} />)
    await typeInto(' text the user must get back')
    await userEvent.tab()

    // The refetch the invalidation triggers is what reaches the not-found path.
    await waitFor(() => expect(onNotFound).toHaveBeenCalled())
    // ...and the banner is still standing after it.
    expect(screen.getByTestId('deleted-note-banner')).toBeInTheDocument()
    expect(screen.getByTestId('deleted-note-text')).toHaveDisplayValue(/text the user must get back/)
  })

  // A second note deleted while an earlier rescue is still on screen must not silently replace it.
  it('keeps an earlier rescue when a second note is deleted', async () => {
    server.use(
      http.get('/api/notes/:noteId', () => HttpResponse.json(detail)),
      http.put('/api/notes/:noteId/content', () => deletedResponse()),
    )

    render(<Harness />)
    await typeInto(' first note text')
    await userEvent.tab()
    await screen.findByTestId('deleted-note-banner')

    reportDeletedNote({ noteId: 'note-2', title: 'Second note', text: 'second note text' })

    // findAllBy* resolves on the FIRST match, so it would return the single existing banner
    // immediately; wait for the count itself.
    await waitFor(() => expect(screen.getAllByTestId('deleted-note-banner')).toHaveLength(2))
    expect(screen.getAllByTestId('deleted-note-text').map((el) => (el as HTMLTextAreaElement).value))
      .toEqual([expect.stringContaining('first note text'), 'second note text'])
  })
})

// Review of this redesign: C1 ("survives unmount") and I1 ("outside every tabpanel") are claims
// about WHERE App renders the banner, and every test above proves them against `Harness`, a
// hand-written mirror of App.tsx. Mirrors drift — deleting `<DeletedNoteRescue />` from App.tsx left
// the whole suite green. This drives the real App so the wiring itself is pinned.
describe('the deleted-note rescue is wired into the real App (BUG-59)', () => {
  it('survives the navigation home that the deleted note triggers', async () => {
    let deleted = false
    server.use(
      http.get('/api/w/:wsId/notes/:noteId', () =>
        deleted
          ? HttpResponse.json({ error: 'note_not_found' }, { status: 404 })
          : HttpResponse.json(detail)),
      http.put('/api/w/:wsId/notes/:noteId/content', () => {
        deleted = true
        return deletedResponse()
      }),
    )
    window.history.replaceState({}, '', '/w/__default__/notes/note-1')

    render(
      <ToastProvider>
        <AuthProvider initialToken="test-token">
          <App />
        </AuthProvider>
      </ToastProvider>,
    )

    await typeInto(' text typed into the real app')
    await userEvent.tab()

    // App bounces home on the not-found refetch...
    await waitFor(() => expect(window.location.pathname).toBe('/w/__default__'))
    // ...and the rescued text is still on screen afterwards, which is the whole point.
    expect(await screen.findByTestId('deleted-note-banner')).toBeInTheDocument()
    expect(screen.getByTestId('deleted-note-text')).toHaveDisplayValue(/text typed into the real app/)
  })
})

// Review: the copy button had no coverage at all — neither the label nor the failure branch. The
// failure branch is the one that matters: a button that silently does nothing invites the user to
// close the tab believing their text was copied.
describe('copying the rescued text (BUG-59)', () => {
  function seedRescue() {
    reportDeletedNote({ noteId: 'note-9', title: 'Gone note', text: 'text worth keeping' })
    return render(
      <ToastProvider>
        <DeletedNoteRescue />
      </ToastProvider>,
    )
  }

  it('confirms the copy when the clipboard accepts it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    seedRescue()
    await userEvent.click(screen.getByTestId('copy-deleted-note-text'))

    expect(writeText).toHaveBeenCalledWith('text worth keeping')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('says so when the clipboard refuses, instead of doing nothing visible', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })

    seedRescue()
    await userEvent.click(screen.getByTestId('copy-deleted-note-text'))

    expect(await screen.findByText(/select the text below/i)).toBeInTheDocument()
    expect(screen.queryByText('Copied')).toBeNull()
  })
})

// The rescue outlives the note deliberately — which means it also outlives SIGN-OUT, since that
// clears the token without reloading. A second user on the same tab must not find the first user's
// meeting notes waiting in a banner.
describe('the rescued text does not survive sign-out (BUG-59)', () => {
  it('is cleared when the user signs out', async () => {
    function SignOutProbe() {
      const { signOut } = useAuth()
      return <button type="button" onClick={signOut}>Sign out</button>
    }

    reportDeletedNote({ noteId: 'note-8', title: 'Private note', text: 'confidential meeting text' })
    render(
      <ToastProvider>
        <AuthProvider initialToken="test-token">
          <DeletedNoteRescue />
          <SignOutProbe />
        </AuthProvider>
      </ToastProvider>,
    )
    expect(screen.getByTestId('deleted-note-banner')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(screen.queryByTestId('deleted-note-banner')).toBeNull())
  })
})
