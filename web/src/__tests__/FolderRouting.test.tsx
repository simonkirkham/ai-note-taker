import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import { render, screen, within, waitFor } from '../test/render'
import { server } from '../test/setup'

// Phase 21-B — distinct URLs for folders (and sub-folders); working back/forward.

const child = { folderId: 'child-1', name: 'Child', children: [] }
const parent = { folderId: 'parent-1', name: 'Parent', children: [child] }

const renderApp = () => render(<AuthProvider initialToken="test-token"><App /></AuthProvider>)

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  server.use(http.get('/api/folders', () => HttpResponse.json({ folders: [parent] })))
})

afterEach(() => clearToken())

describe('FolderRouting (21-B)', () => {
  it('opening a folder pushes a /folders/:id URL', async () => {
    renderApp()
    await userEvent.click(await within(screen.getByTestId('sidebar')).findByText('Parent'))
    expect(await screen.findByRole('heading', { name: 'Parent' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/folders/parent-1')
  })

  it('Back from a folder returns home', async () => {
    renderApp()
    await userEvent.click(await within(screen.getByTestId('sidebar')).findByText('Parent'))
    await screen.findByRole('heading', { name: 'Parent' })

    window.history.back()

    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('deep-linking /folders/:id shows the folder heading once the tree loads', async () => {
    window.history.replaceState({}, '', '/folders/parent-1')
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Parent' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/folders/parent-1')
  })

  it('deep-linking a sub-folder rebuilds the full breadcrumb', async () => {
    window.history.replaceState({}, '', '/folders/child-1')
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Parent → Child' })).toBeInTheDocument()
  })

  it('Unfiled Notes has its own URL', async () => {
    window.history.replaceState({}, '', '/folders/unfiled')
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Unfiled Notes' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/folders/unfiled')
  })
})
