import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import App from '../App'

const renderApp = () => render(<AuthProvider initialToken="test-token"><App /></AuthProvider>)

afterEach(() => clearToken())

beforeEach(() => {
  server.use(http.get('/api/folders', () => HttpResponse.json({ folders: [] })))
})

describe('FolderMutations', () => {
  it('created folder appears in the sidebar immediately and persists after API resolves', async () => {
    let resolveCreate!: () => void
    server.use(
      http.post('/api/folders', () =>
        new Promise<Response>((res) => {
          resolveCreate = () => res(HttpResponse.json({ folderId: 'f-real' }, { status: 201 }) as unknown as Response)
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
      http.get('/api/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-real', name: 'People', children: [] }] }),
      ),
    )
    // Resolve the POST; the app then refetches folders and folder should persist
    await act(async () => { resolveCreate() })
    expect(await within(screen.getByTestId('sidebar')).findByText('People')).toBeInTheDocument()
  })

  it('renamed folder shows the new name in the sidebar immediately', async () => {
    server.use(
      http.get('/api/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'Peopl', children: [] }] }),
      ),
    )
    let resolveRename: () => void
    server.use(
      http.patch('/api/folders/f-1/name', () =>
        new Promise<Response>((res) => {
          resolveRename = () => res(new HttpResponse(null, { status: 204 }) as unknown as Response)
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
    await act(async () => { resolveRename!() })
  })

  it('created subfolder appears nested under parent in sidebar', async () => {
    let resolveCreate!: () => void
    server.use(
      http.get('/api/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'People', children: [] }] }),
      ),
      http.post('/api/folders', () =>
        new Promise<Response>((res) => {
          resolveCreate = () => res(HttpResponse.json({ folderId: 'f-child' }, { status: 201 }) as unknown as Response)
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
      http.get('/api/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'People', children: [{ folderId: 'f-child', name: 'Simon', children: [] }] }] }),
      ),
    )
    await act(async () => { resolveCreate() })
    expect(within(screen.getByTestId('folder-item-f-1')).getByText('Simon')).toBeInTheDocument()
  })

  it('failed subfolder creation is rolled back from the parent', async () => {
    let resolveWithError!: () => void
    server.use(
      http.get('/api/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'People', children: [] }] }),
      ),
      http.post('/api/folders', () =>
        new Promise<Response>((res) => {
          resolveWithError = () => res(new HttpResponse(null, { status: 500 }) as unknown as Response)
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
    // Resolve with error → catch block removes Simon
    await act(async () => { resolveWithError() })
    expect(within(screen.getByTestId('folder-item-f-1')).queryByText('Simon')).not.toBeInTheDocument()
  })

  it('renaming the active folder updates the main heading immediately', async () => {
    server.use(
      http.get('/api/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'Peopl', children: [] }] }),
      ),
      http.patch('/api/folders/f-1/name', () => new HttpResponse(null, { status: 204 })),
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
})
