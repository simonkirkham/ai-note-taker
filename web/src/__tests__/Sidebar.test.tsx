import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sidebar from '../components/Sidebar'
import type { NoteItem } from '../api'

const note1: NoteItem = { noteId: 'n-1', title: 'Alpha' }
const note2: NoteItem = { noteId: 'n-2', title: 'Beta' }

const noop = () => {}

function renderSidebar(notes: NoteItem[], activeNoteId?: string) {
  return render(
    <Sidebar
      notes={notes}
      activeNoteId={activeNoteId}
      open={true}
      onSelect={noop}
      onCreate={noop}
      folders={[]}
      activeFolderId={undefined}
      onFolderSelect={noop}
      onCreateFolder={noop}
      onRenameFolder={noop}
      onDeleteFolder={noop}
      onCreateChildFolder={noop}
      onDropNote={noop}
      onHome={noop}
      onUnfiledSelect={noop}
      isUnfiledActive={false}
      onDropToUnfiled={noop}
      onPreview={noop}
    />,
  )
}

describe('Sidebar', () => {
  it('renders note titles from the notes prop', () => {
    renderSidebar([note1, note2])
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('calls onSelect with the note id when a note is clicked', async () => {
    const onSelect = vi.fn()
    render(
      <Sidebar
        notes={[note1, note2]}
        activeNoteId={undefined}
        open={true}
        onSelect={onSelect}
        onCreate={noop}
        folders={[]}
        activeFolderId={undefined}
        onFolderSelect={noop}
        onCreateFolder={noop}
        onRenameFolder={noop}
        onDeleteFolder={noop}
        onCreateChildFolder={noop}
        onDropNote={noop}
        onHome={noop}
        onUnfiledSelect={noop}
        isUnfiledActive={false}
        onDropToUnfiled={noop}
        onPreview={noop}
      />,
    )
    await userEvent.click(screen.getByText('Beta'))
    expect(onSelect).toHaveBeenCalledWith('n-2')
  })

  it('active note has the active CSS class; inactive note does not', () => {
    renderSidebar([note1, note2], 'n-1')
    const alphaBtn = screen.getByText('Alpha').closest('button')!
    const betaBtn = screen.getByText('Beta').closest('button')!
    expect(alphaBtn).toHaveClass('sidebar-note-item--active')
    expect(betaBtn).not.toHaveClass('sidebar-note-item--active')
  })

  it('renders untitled placeholder for notes with empty title', () => {
    renderSidebar([{ noteId: 'n-3', title: '' }])
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('new note title appears when notes prop is updated', () => {
    const { rerender } = renderSidebar([note1])
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    rerender(
      <Sidebar
        notes={[note1, note2]}
        activeNoteId={undefined}
        open={true}
        onSelect={noop}
        onCreate={noop}
        folders={[]}
        activeFolderId={undefined}
        onFolderSelect={noop}
        onCreateFolder={noop}
        onRenameFolder={noop}
        onDeleteFolder={noop}
        onCreateChildFolder={noop}
        onDropNote={noop}
        onHome={noop}
        onUnfiledSelect={noop}
        isUnfiledActive={false}
        onDropToUnfiled={noop}
        onPreview={noop}
      />,
    )
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })
})
