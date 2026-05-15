import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import FolderPreviewPanel from '../components/FolderPreviewPanel'

const noop = () => {}

const cardInFolder = {
  noteId: 'n-1', title: '1:1 with Bill', date: null,
  contentPreview: '', actionCount: 0, folderId: 'f-1', tags: [],
}
const cardOtherFolder = {
  noteId: 'n-2', title: 'Team standup', date: null,
  contentPreview: '', actionCount: 0, folderId: 'f-2', tags: [],
}
const cardUnfiled = {
  noteId: 'n-3', title: 'Random note', date: null,
  contentPreview: '', actionCount: 0, folderId: null, tags: [],
}

describe('FolderPreviewPanel', () => {
  it('shows notes that belong to the opened folder', async () => {
    server.use(
      http.get('/notes/cards', () =>
        HttpResponse.json({ cards: [cardInFolder, cardOtherFolder] }),
      ),
    )
    render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(await screen.findByText('1:1 with Bill')).toBeInTheDocument()
    expect(screen.queryByText('Team standup')).not.toBeInTheDocument()
  })

  it('shows empty state when no notes match the folder', async () => {
    server.use(
      http.get('/notes/cards', () => HttpResponse.json({ cards: [cardOtherFolder] })),
    )
    render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(await screen.findByText('No notes in this folder')).toBeInTheDocument()
  })

  it('shows only unfiled notes when opened with UNFILED_ID', async () => {
    server.use(
      http.get('/notes/cards', () =>
        HttpResponse.json({ cards: [cardInFolder, cardUnfiled] }),
      ),
    )
    render(
      <FolderPreviewPanel
        folderId="__unfiled__"
        folderName="Unfiled Notes"
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(await screen.findByText('Random note')).toBeInTheDocument()
    expect(screen.queryByText('1:1 with Bill')).not.toBeInTheDocument()
  })

  it('shows nothing when folderId is null (panel closed)', () => {
    render(
      <FolderPreviewPanel
        folderId={null}
        folderName=""
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.queryByText('No notes in this folder')).not.toBeInTheDocument()
  })
})
