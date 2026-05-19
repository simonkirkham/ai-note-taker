import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sidebar from '../components/Sidebar'
import type { FolderNode } from '../api'
import { UNFILED_ID } from '../constants'

const folder: FolderNode = { folderId: 'f-1', name: 'People', children: [] }

const noop = () => {}

function renderSidebar(folders: FolderNode[] = []) {
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
        onPreview={onPreview}
      />,
    )
    await userEvent.click(screen.getByTestId('unfiled-preview-button'))
    expect(onPreview).toHaveBeenCalledWith(UNFILED_ID, 'Unfiled Notes')
  })
})
