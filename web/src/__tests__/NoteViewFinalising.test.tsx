import NoteView from '../components/NoteView'
import { ToastProvider } from '../components/ToastProvider'
import type { TranscriptionStatus, UseTranscriptionResult } from '../hooks/useTranscription'
import { render, screen } from '../test/render'

// NoteView renders the editor via a lazy chunk; mock it with a synchronous textarea (as
// NoteView.test does) so this test is free of Suspense timing.
vi.mock('../components/LazyNoteEditor', () => ({
  default: ({ value, onChange, onBlur }: { value: string; onChange: (md: string) => void; onBlur: () => void }) => (
    <textarea aria-label="Note content" data-testid="note-content" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
  ),
}))

// 48-B — regression guard (Hawk PR #401). During the on-device final pass the status is
// 'finalising' for MINUTES. NoteView must treat it as an active recording session: a fresh note
// with no typed title/content must still show Save (never Cancel, which deletes it), and the live
// transcript must stay on screen. Before the fix, hasContent dropped false → Cancel/delete.

let mockStatus: TranscriptionStatus = 'finalising'

vi.mock('../hooks/useTranscription', () => ({
  useTranscription: (): UseTranscriptionResult => ({
    status: mockStatus,
    transcript: 'live words so far',
    elapsedSeconds: 0,
    error: undefined,
    recordingUpload: 'uploading',
    diarization: 'idle',
    startRecording: () => {},
    stopRecording: () => {},
    reset: () => {},
  }),
}))

// Passive RecordControl stand-in (mirrors the controlled component).
vi.mock('../components/RecordControl', () => ({
  default: () => <div data-testid="record-control-mock" />,
}))

const noop = () => {}
const asyncNoop = async () => {}

function renderFresh() {
  return render(
    <ToastProvider>
      <NoteView
        noteId="note-fin"
        initialTitle=""
        isNew
        onBack={noop}
        onDelete={asyncNoop}
        onDateSet={noop}
        onOpenNote={noop}
      />
    </ToastProvider>,
  )
}

it('shows Save (not Cancel) for a fresh note while finalising — the note is protected', () => {
  mockStatus = 'finalising'
  renderFresh()
  expect(screen.getByTestId('save-button')).toBeInTheDocument()
  expect(screen.queryByTestId('cancel-button')).not.toBeInTheDocument()
})

it('keeps the live transcript visible while finalising', () => {
  mockStatus = 'finalising'
  renderFresh()
  expect(screen.getByText(/live words so far/)).toBeInTheDocument()
})
