import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FolderNode } from '../api'
import Sidebar from '../components/Sidebar'
import { UNFILED_ID } from '../constants'

const folder: FolderNode = { folderId: 'f-1', name: 'People', children: [] }

const noop = () => {}

function renderSidebar(folders: FolderNode[] = [], previewFolderId: string | null = null) {
  return render(
    <Sidebar
      open={true}
      onCreate={noop}
      folders={folders}
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
      previewFolderId={previewFolderId}
      onPreview={noop}
    />,
  )
}

describe('Sidebar', () => {
  it('renders no individual note list', () => {
    renderSidebar()
    expect(screen.queryByTestId('note-list')).not.toBeInTheDocument()
  })

  it('shows folder navigation elements', () => {
    renderSidebar([folder])
    expect(screen.getByTestId('home-button')).toBeInTheDocument()
    expect(screen.getByTestId('unfiled-notes-button')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
  })

  it('calls onFolderSelect when a folder is clicked', async () => {
    const onFolderSelect = vi.fn()
    render(
      <Sidebar
        open={true}
        onCreate={noop}
        folders={[folder]}
        activeFolderId={undefined}
        onFolderSelect={onFolderSelect}
        onCreateFolder={noop}
        onRenameFolder={noop}
        onDeleteFolder={noop}
        onCreateChildFolder={noop}
        onDropNote={noop}
        onHome={noop}
        onUnfiledSelect={noop}
        isUnfiledActive={false}
        onDropToUnfiled={noop}
        previewFolderId={null}
        onPreview={noop}
      />,
    )
    await userEvent.click(screen.getByText('People'))
    expect(onFolderSelect).toHaveBeenCalledWith('f-1', expect.any(Array))
  })

  it('does not render sign-out button when onSignOut is not provided', () => {
    renderSidebar()
    expect(screen.queryByTestId('sign-out-button')).not.toBeInTheDocument()
  })

  it('renders sign-out button and calls onSignOut when clicked', async () => {
    const onSignOut = vi.fn()
    render(
      <Sidebar
        open={true}
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
        previewFolderId={null}
        onPreview={noop}
        onSignOut={onSignOut}
      />,
    )
    await userEvent.click(screen.getByTestId('sign-out-button'))
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('calls onPreview with unfiled sentinel when » is clicked', async () => {
    const onPreview = vi.fn()
    render(
      <Sidebar
        open={true}
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
        previewFolderId={null}
        onPreview={onPreview}
      />,
    )
    await userEvent.click(screen.getByTestId('unfiled-preview-button'))
    expect(onPreview).toHaveBeenCalledWith(UNFILED_ID, 'Unfiled Notes')
  })

  // CHANGE-11 — preview button reflects open/closed state with » / «
  it('unfiled preview button shows » and "Preview" label when its panel is closed', () => {
    renderSidebar([], null)
    const btn = screen.getByTestId('unfiled-preview-button')
    expect(btn).toHaveTextContent('»')
    expect(btn).toHaveAttribute('aria-label', 'Preview unfiled notes')
  })

  it('unfiled preview button shows « and "Close" label when its panel is open', () => {
    renderSidebar([], UNFILED_ID)
    const btn = screen.getByTestId('unfiled-preview-button')
    expect(btn).toHaveTextContent('«')
    expect(btn).toHaveAttribute('aria-label', 'Close unfiled preview')
  })

  it('shows « only on the previewed folder; every other preview button shows »', () => {
    const folders: FolderNode[] = [
      { folderId: 'f-1', name: 'People', children: [] },
      { folderId: 'f-2', name: 'Projects', children: [] },
    ]
    renderSidebar(folders, 'f-1')
    // The previewed folder (f-1) shows the collapse affordance.
    const open = screen.getByRole('button', { name: 'Close folder preview' })
    expect(open).toHaveTextContent('«')
    // The other folder (f-2) still shows »; unfiled uses its own label, so this
    // matches only the non-previewed folder row.
    const closed = screen.getAllByRole('button', { name: 'Preview folder notes' })
    expect(closed).toHaveLength(1)
    expect(closed[0]).toHaveTextContent('»')
  })
})
