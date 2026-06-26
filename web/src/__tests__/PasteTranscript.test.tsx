import userEvent from '@testing-library/user-event'
import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import PasteTranscript from '../components/PasteTranscript'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

const NOTE_ID = 'note-123'

// Register on both rootless and workspace-scoped paths: an isolated render has no WorkspaceProvider.
function importHandlers(resolver: HttpResponseResolver) {
  return [
    http.post(`/api/notes/${NOTE_ID}/import-transcript`, resolver),
    http.post(`/api/w/:wsId/notes/${NOTE_ID}/import-transcript`, resolver),
  ]
}

describe('PasteTranscript', () => {
  // Submits the pasted text once into the note, shows an importing state, then calls onImported.
  it('submits the pasted text once, shows Importing…, then calls onImported', async () => {
    let resolveImport!: () => void
    let captured: unknown
    server.use(
      ...importHandlers(async ({ request }) => {
        captured = await request.json()
        return new Promise<Response>((res) => {
          resolveImport = () =>
            res(new HttpResponse(null, { status: 204, headers: { 'X-Consistency-Token': `note#${NOTE_ID}@7` } }))
        })
      }),
    )
    const onImported = vi.fn()
    render(<PasteTranscript noteId={NOTE_ID} hasTranscript={false} onImported={onImported} />)

    await userEvent.click(screen.getByTestId('paste-transcript-button'))
    await userEvent.type(screen.getByTestId('paste-transcript-textarea'), 'pasted transcript')
    await userEvent.click(screen.getByTestId('paste-transcript-submit'))

    expect(await screen.findByText('Importing…')).toBeInTheDocument()
    expect(captured).toEqual({ transcriptText: 'pasted transcript' })

    resolveImport()
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  })

  // When the note already has a transcript: a replace warning + the button reads "Replace & analyse".
  it('warns and offers Replace & analyse when the note already has a transcript', async () => {
    render(<PasteTranscript noteId={NOTE_ID} hasTranscript onImported={vi.fn()} />)
    await userEvent.click(screen.getByTestId('paste-transcript-button'))

    expect(screen.getByTestId('paste-transcript-replace-warning')).toBeInTheDocument()
    expect(screen.getByTestId('paste-transcript-submit')).toHaveTextContent('Replace & analyse')
  })

  // No transcript yet: no warning, button reads "Import & analyse".
  it('shows no replace warning when the note has no transcript', async () => {
    render(<PasteTranscript noteId={NOTE_ID} hasTranscript={false} onImported={vi.fn()} />)
    await userEvent.click(screen.getByTestId('paste-transcript-button'))

    expect(screen.queryByTestId('paste-transcript-replace-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('paste-transcript-submit')).toHaveTextContent('Import & analyse')
  })

  it('disables the submit button until non-whitespace text is entered', async () => {
    render(<PasteTranscript noteId={NOTE_ID} hasTranscript={false} onImported={vi.fn()} />)
    await userEvent.click(screen.getByTestId('paste-transcript-button'))

    expect(screen.getByTestId('paste-transcript-submit')).toBeDisabled()
    await userEvent.type(screen.getByTestId('paste-transcript-textarea'), '   ')
    expect(screen.getByTestId('paste-transcript-submit')).toBeDisabled()
    await userEvent.type(screen.getByTestId('paste-transcript-textarea'), 'real text')
    expect(screen.getByTestId('paste-transcript-submit')).toBeEnabled()
  })

  it('keeps the modal open with the pasted text on failure and shows an error', async () => {
    server.use(...importHandlers(() => HttpResponse.json({}, { status: 500 })))
    const onImported = vi.fn()
    render(<PasteTranscript noteId={NOTE_ID} hasTranscript={false} onImported={onImported} />)

    await userEvent.click(screen.getByTestId('paste-transcript-button'))
    await userEvent.type(screen.getByTestId('paste-transcript-textarea'), 'my transcript')
    await userEvent.click(screen.getByTestId('paste-transcript-submit'))

    expect(await screen.findByTestId('paste-transcript-error')).toBeInTheDocument()
    expect(screen.getByTestId('paste-transcript-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('paste-transcript-textarea')).toHaveValue('my transcript')
    expect(onImported).not.toHaveBeenCalled()
  })
})
