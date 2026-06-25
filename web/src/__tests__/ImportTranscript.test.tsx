import userEvent from '@testing-library/user-event'
import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import ImportTranscript from '../components/ImportTranscript'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

// Register the import handler on both the rootless and workspace-scoped paths: an isolated
// component render has no WorkspaceProvider, so the api client leaves the path un-prefixed.
function importHandlers(resolver: HttpResponseResolver) {
  return [
    http.post('/api/notes/import-transcript', resolver),
    http.post('/api/w/:wsId/notes/import-transcript', resolver),
  ]
}

describe('ImportTranscript', () => {
  // Scenario 6 + 7: the pasted text is sent once, the button shows an importing state, and on
  // success onImported is called with the new note id (the caller navigates to it).
  it('submits the pasted text once, shows Importing…, then calls onImported with the note id', async () => {
    let resolveImport!: () => void
    let captured: unknown
    server.use(
      ...importHandlers(async ({ request }) => {
        captured = await request.json()
        return new Promise<Response>((res) => {
          resolveImport = () =>
            res(
              HttpResponse.json(
                { noteId: 'note-imported' },
                { status: 201, headers: { 'X-Consistency-Token': 'note#note-imported@5' } },
              ),
            )
        })
      }),
    )
    const onImported = vi.fn()
    render(<ImportTranscript onImported={onImported} />)

    await userEvent.click(screen.getByTestId('import-transcript-button'))
    await userEvent.type(screen.getByTestId('import-transcript-textarea'), 'pasted transcript')
    await userEvent.click(screen.getByTestId('import-transcript-submit'))

    // Optimistic: the button flips to an importing state immediately, before the request resolves.
    expect(await screen.findByText('Importing…')).toBeInTheDocument()
    expect(captured).toEqual({ transcriptText: 'pasted transcript' })

    resolveImport()
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('note-imported'))
  })

  // Scenario 9: the submit button is disabled while the textarea is empty or whitespace.
  it('disables Import & analyse until non-whitespace text is entered', async () => {
    render(<ImportTranscript onImported={vi.fn()} />)
    await userEvent.click(screen.getByTestId('import-transcript-button'))

    expect(screen.getByTestId('import-transcript-submit')).toBeDisabled()
    await userEvent.type(screen.getByTestId('import-transcript-textarea'), '   ')
    expect(screen.getByTestId('import-transcript-submit')).toBeDisabled()
    await userEvent.type(screen.getByTestId('import-transcript-textarea'), 'real text')
    expect(screen.getByTestId('import-transcript-submit')).toBeEnabled()
  })

  // Scenario 8: on failure the modal stays open with the pasted text preserved and an inline error.
  it('keeps the modal open with the pasted text on failure and shows an error', async () => {
    server.use(...importHandlers(() => HttpResponse.json({}, { status: 500 })))
    const onImported = vi.fn()
    render(<ImportTranscript onImported={onImported} />)

    await userEvent.click(screen.getByTestId('import-transcript-button'))
    await userEvent.type(screen.getByTestId('import-transcript-textarea'), 'my transcript')
    await userEvent.click(screen.getByTestId('import-transcript-submit'))

    expect(await screen.findByTestId('import-transcript-error')).toBeInTheDocument()
    expect(screen.getByTestId('import-transcript-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('import-transcript-textarea')).toHaveValue('my transcript')
    expect(onImported).not.toHaveBeenCalled()
  })
})
