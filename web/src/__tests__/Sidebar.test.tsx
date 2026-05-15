import { render, screen } from '@testing-library/react'
import Sidebar from '../components/Sidebar'
import type { FolderNode } from '../api'

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
})
