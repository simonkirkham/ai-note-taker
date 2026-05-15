import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import App from '../App'

beforeEach(() => {
  server.use(http.get('/folders', () => HttpResponse.json({ folders: [] })))
})

describe('FolderMutations', () => {
  it('created folder appears in the sidebar immediately after user submits the name', async () => {
    let resolveCreate: (value: Response) => void
    server.use(
      http.post('/folders', () =>
        new Promise<Response>((res) => {
          resolveCreate = () => res(HttpResponse.json({ folderId: 'f-real' }, { status: 201 }) as unknown as Response)
        }),
      ),
    )
    render(<App />)
    await userEvent.click(await screen.findByTestId('new-folder-button'))
    await userEvent.type(screen.getByTestId('new-folder-input'), 'People')
    await userEvent.keyboard('{Enter}')
    // Folder should appear in sidebar before API responds
    expect(within(screen.getByTestId('sidebar')).getByText('People')).toBeInTheDocument()
    // Unblock the API so cleanup doesn't hang
    resolveCreate!(new Response())
  })

  it('renamed folder shows the new name in the sidebar immediately', async () => {
    server.use(
      http.get('/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'Peopl', children: [] }] }),
      ),
    )
    let resolveRename: () => void
    server.use(
      http.patch('/folders/f-1/name', () =>
        new Promise<Response>((res) => {
          resolveRename = () => res(new HttpResponse(null, { status: 204 }) as unknown as Response)
        }),
      ),
    )
    render(<App />)
    // Double-click the folder name to enter edit mode
    const folderNameBtn = await screen.findByTestId('folder-name-f-1')
    await userEvent.dblClick(folderNameBtn)
    const renameInput = screen.getByRole('textbox', { name: 'Rename folder' })
    await userEvent.clear(renameInput)
    await userEvent.type(renameInput, 'People')
    await userEvent.keyboard('{Enter}')
    // Name should update immediately (before API responds)
    expect(within(screen.getByTestId('sidebar')).getByText('People')).toBeInTheDocument()
    resolveRename!()
  })

  it('renaming the active folder updates the main heading immediately', async () => {
    server.use(
      http.get('/folders', () =>
        HttpResponse.json({ folders: [{ folderId: 'f-1', name: 'Peopl', children: [] }] }),
      ),
      http.patch('/folders/f-1/name', () => new HttpResponse(null, { status: 204 })),
    )
    render(<App />)
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
