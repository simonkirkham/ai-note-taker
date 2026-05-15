import { render, screen, fireEvent } from '@testing-library/react'
import FolderPreviewPanel from '../components/FolderPreviewPanel'
import type { NoteCard } from '../api'

const noop = () => {}

const cardInFolder: NoteCard = {
  noteId: 'n-1', title: '1:1 with Bill', date: null,
  contentPreview: '', openActions: [], createdAt: '2024-01-01', folderId: 'f-1', tags: [],
}
const cardOtherFolder: NoteCard = {
  noteId: 'n-2', title: 'Team standup', date: null,
  contentPreview: '', openActions: [], createdAt: '2024-01-01', folderId: 'f-2', tags: [],
}
const cardUnfiled: NoteCard = {
  noteId: 'n-3', title: 'Random note', date: null,
  contentPreview: '', openActions: [], createdAt: '2024-01-01', folderId: null, tags: [],
}

describe('FolderPreviewPanel', () => {
  it('shows notes that belong to the opened folder', () => {
    render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[cardInFolder, cardOtherFolder]}
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.getByText('1:1 with Bill')).toBeInTheDocument()
    expect(screen.queryByText('Team standup')).not.toBeInTheDocument()
  })

  it('shows empty state when no notes match the folder', () => {
    render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[cardOtherFolder]}
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.getByText('No notes in this folder')).toBeInTheDocument()
  })

  it('shows only unfiled notes when opened with UNFILED_ID', () => {
    render(
      <FolderPreviewPanel
        folderId="__unfiled__"
        folderName="Unfiled Notes"
        cards={[cardInFolder, cardUnfiled]}
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.getByText('Random note')).toBeInTheDocument()
    expect(screen.queryByText('1:1 with Bill')).not.toBeInTheDocument()
  })

  it('shows nothing when folderId is null (panel closed)', () => {
    render(
      <FolderPreviewPanel
        folderId={null}
        folderName=""
        cards={[]}
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.queryByText('No notes in this folder')).not.toBeInTheDocument()
  })

  it('shows a drag-over indicator when dragging over the panel and clears it on leave', () => {
    render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[cardOtherFolder]}
        onClose={noop}
        onEditNote={noop}
        onDropNote={noop}
      />,
    )
    const panel = screen.getByTestId('folder-preview-panel')
    fireEvent.dragOver(panel, { dataTransfer: { dropEffect: '' } })
    expect(panel).toHaveClass('folder-preview-panel--drag-over')
    fireEvent.dragLeave(panel)
    expect(panel).not.toHaveClass('folder-preview-panel--drag-over')
  })

  it('drop calls onDropNote with the dragged noteId', () => {
    const onDropNote = vi.fn()
    render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[cardOtherFolder]}
        onClose={noop}
        onEditNote={noop}
        onDropNote={onDropNote}
      />,
    )
    const panel = screen.getByTestId('folder-preview-panel')
    fireEvent.drop(panel, { dataTransfer: { getData: () => 'n-2' } })
    expect(onDropNote).toHaveBeenCalledWith('n-2')
  })

  it('panel no longer shows the note when parent removes it from cards (optimistic update)', () => {
    const { rerender } = render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[cardInFolder]}
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.getByText('1:1 with Bill')).toBeInTheDocument()
    rerender(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[]}
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.queryByText('1:1 with Bill')).not.toBeInTheDocument()
    expect(screen.getByText('No notes in this folder')).toBeInTheDocument()
  })

  it('panel shows the note again when parent restores it in cards (failed-move revert)', () => {
    const { rerender } = render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[]}
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.getByText('No notes in this folder')).toBeInTheDocument()
    rerender(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[cardInFolder]}
        onClose={noop}
        onEditNote={noop}
      />,
    )
    expect(screen.getByText('1:1 with Bill')).toBeInTheDocument()
  })

  it('drop does nothing if note is already in the target folder', () => {
    const onDropNote = vi.fn()
    render(
      <FolderPreviewPanel
        folderId="f-1"
        folderName="People"
        cards={[cardInFolder]}
        onClose={noop}
        onEditNote={noop}
        onDropNote={onDropNote}
      />,
    )
    const panel = screen.getByTestId('folder-preview-panel')
    fireEvent.drop(panel, { dataTransfer: { getData: () => 'n-1' } })
    expect(onDropNote).not.toHaveBeenCalled()
  })
})
