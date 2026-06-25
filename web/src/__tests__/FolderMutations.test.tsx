import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { render, screen, within, act, waitFor } from '../test/render'
import { server } from '../test/setup'

const renderApp = () => render(<AuthProvider initialToken="test-token"><App /></AuthProvider>)

afterEach(() => clearToken())

beforeEach(() => {
  server.use(http.get('/api/w/:wsId/folders', () => HttpResponse.json({ folders: [] })))
})

describe('FolderMutations', () => {
  it('created folder appears in the sidebar immediately and persists after API resolves', async () => {
    let resolveCreate!: () => void
    server.use(
      http.post('/api/w/:wsId/folders', () =>
        new Promise<Response>((res) => {
          resolveCreate = () => res(HttpResponse.json({ folderId: 'f-real' }, { status: 201 }))
        }),
      ),
    )
    renderApp()
    await userEvent.click(await screen.findByTestId('new-folder-button'))
    await userEvent.type(screen.getByTestId('new-folder-input'), 'People')
    await userEvent.keyboard('{Enter}')
    // Folder should appear in sidebar before API responds
    expect(within(screen.getByTestId('sidebar')).getByText('People')).toBeInTheDocument()
    // Override GET /folders to return the real folder so the refetch after POST is correct
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-real', name: 'People', children: [] }] }),
      ),
    )
    // Resolve the POST; the app then refetches folders and the real-id folder should persist
    await act(async () => { resolveCreate() })
    expect(await within(screen.getByTestId('sidebar')).findByTestId('folder-name-f-real')).toBeInTheDocument()
    expect(within(screen.getByTestId('sidebar')).getByText('People')).toBeInTheDocument()
    // The optimistic temp folder is swapped out, not left as a duplicate
    expect(within(screen.getByTestId('sidebar')).queryByTestId(/folder-name-temp-/)).not.toBeInTheDocument()
  })

  it('renamed folder shows the new name in the sidebar immediately', async () => {
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'Peopl', children: [] }] }),
      ),
    )
    let resolveRename: () => void
    server.use(
      http.patch('/api/w/:wsId/folders/f-1/name', () =>
        new Promise<Response>((res) => {
          resolveRename = () => res(new HttpResponse(null, { status: 204 }))
        }),
      ),
    )
    renderApp()
    // Double-click the folder name to enter edit mode
    const folderNameBtn = await screen.findByTestId('folder-name-f-1')
    await userEvent.dblClick(folderNameBtn)
    const renameInput = screen.getByRole('textbox', { name: 'Rename folder' })
    await userEvent.clear(renameInput)
    await userEvent.type(renameInput, 'People')
    await userEvent.keyboard('{Enter}')
    // Name should update immediately (before API responds)
    expect(within(screen.getByTestId('sidebar')).getByText('People')).toBeInTheDocument()
    // Override GET so the onSettled refetch reflects the rename (not the old name)
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'People', children: [] }] }),
      ),
    )
    await act(async () => { resolveRename!() })
    // Still renamed after the post-mutation refetch reconciles
    expect(await within(screen.getByTestId('sidebar')).findByText('People')).toBeInTheDocument()
  })

  it('rename rolls back to the old name when the request fails', async () => {
    let rejectRename!: () => void
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'Peopl', children: [] }] }),
      ),
      http.patch('/api/w/:wsId/folders/f-1/name', () =>
        new Promise<Response>((res) => {
          rejectRename = () => res(new HttpResponse(null, { status: 500 }))
        }),
      ),
    )
    renderApp()
    await userEvent.dblClick(await screen.findByTestId('folder-name-f-1'))
    const renameInput = screen.getByRole('textbox', { name: 'Rename folder' })
    await userEvent.clear(renameInput)
    await userEvent.type(renameInput, 'People')
    await userEvent.keyboard('{Enter}')
    // Optimistic rename shows immediately…
    expect(within(screen.getByTestId('sidebar')).getByText('People')).toBeInTheDocument()
    // …then reverts once the failure rolls the cache back
    await act(async () => { rejectRename() })
    expect(await within(screen.getByTestId('sidebar')).findByText('Peopl')).toBeInTheDocument()
    expect(within(screen.getByTestId('sidebar')).queryByText('People')).not.toBeInTheDocument()
  })

  it('created subfolder appears nested under parent in sidebar', async () => {
    let resolveCreate!: () => void
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'People', children: [] }] }),
      ),
      http.post('/api/w/:wsId/folders', () =>
        new Promise<Response>((res) => {
          resolveCreate = () => res(HttpResponse.json({ folderId: 'f-child' }, { status: 201 }))
        }),
      ),
    )
    renderApp()
    const folderItem = await screen.findByTestId('folder-item-f-1')
    await userEvent.click(within(folderItem).getByTestId('add-subfolder-button'))
    await userEvent.type(screen.getByTestId('subfolder-input'), 'Simon')
    await userEvent.keyboard('{Enter}')
    // Child appears optimistically while POST is still pending
    expect(within(screen.getByTestId('folder-item-f-1')).getByText('Simon')).toBeInTheDocument()
    // Override GET to return the real child, then resolve POST so refetch lands correctly
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'People', children: [{ folderId: 'f-child', name: 'Simon', children: [] }] }] }),
      ),
    )
    await act(async () => { resolveCreate() })
    expect(within(screen.getByTestId('folder-item-f-1')).getByText('Simon')).toBeInTheDocument()
  })

  it('failed subfolder creation is rolled back from the parent', async () => {
    let resolveWithError!: () => void
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'People', children: [] }] }),
      ),
      http.post('/api/w/:wsId/folders', () =>
        new Promise<Response>((res) => {
          resolveWithError = () => res(new HttpResponse(null, { status: 500 }))
        }),
      ),
    )
    renderApp()
    const folderItem = await screen.findByTestId('folder-item-f-1')
    await userEvent.click(within(folderItem).getByTestId('add-subfolder-button'))
    await userEvent.type(screen.getByTestId('subfolder-input'), 'Simon')
    await userEvent.keyboard('{Enter}')
    // Appears optimistically before API responds
    expect(within(screen.getByTestId('folder-item-f-1')).getByText('Simon')).toBeInTheDocument()
    // Resolve with error → onError rollback removes Simon (async settle)
    await act(async () => { resolveWithError() })
    await waitFor(() =>
      expect(within(screen.getByTestId('folder-item-f-1')).queryByText('Simon')).not.toBeInTheDocument())
  })

  it('renaming the active folder updates the main heading immediately', async () => {
    let renamed = false
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: renamed ? 'People' : 'Peopl', children: [] }] }),
      ),
      http.patch('/api/w/:wsId/folders/f-1/name', () => { renamed = true; return new HttpResponse(null, { status: 204 }) }),
    )
    renderApp()
    // Navigate into the folder first
    await userEvent.click(await screen.findByTestId('folder-name-f-1'))
    expect(screen.getByRole('heading', { name: 'Peopl' })).toBeInTheDocument()
    // Double-click to rename
    await userEvent.dblClick(screen.getByTestId('folder-name-f-1'))
    const renameInput = screen.getByRole('textbox', { name: 'Rename folder' })
    await userEvent.clear(renameInput)
    await userEvent.type(renameInput, 'People')
    await userEvent.keyboard('{Enter}')
    // Heading should update immediately
    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
  })

  it('deleting a folder removes it optimistically and rolls back on failure', async () => {
    let rejectDelete!: () => void
    server.use(
      http.get('/api/w/:wsId/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'People', children: [] }] }),
      ),
      http.delete('/api/w/:wsId/folders/f-1', () =>
        new Promise<Response>((res) => {
          rejectDelete = () => res(new HttpResponse(null, { status: 500 }))
        }),
      ),
    )
    renderApp()
    const folderItem = await screen.findByTestId('folder-item-f-1')
    await userEvent.click(within(folderItem).getByRole('button', { name: 'Delete folder' }))
    // Removed optimistically before the API responds
    await waitFor(() =>
      expect(within(screen.getByTestId('sidebar')).queryByText('People')).not.toBeInTheDocument())
    // Resolve with error → rollback restores it
    await act(async () => { rejectDelete() })
    expect(await within(screen.getByTestId('sidebar')).findByText('People')).toBeInTheDocument()
  })
})
