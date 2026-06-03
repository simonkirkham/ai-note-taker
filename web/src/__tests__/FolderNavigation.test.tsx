import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken } from '../auth/tokenStore'
import folderPreviewStyles from '../components/FolderPreviewPanel.module.css'
import { server } from '../test/setup'

const folder = { folderId: 'f-1', name: 'People', children: [] }

const renderApp = () => render(<AuthProvider initialToken="test-token"><App /></AuthProvider>)

afterEach(() => clearToken())

beforeEach(() => {
  // Persistent override (not one-shot); reset happens in global afterEach via server.resetHandlers()
  server.use(http.get('/api/folders', () => HttpResponse.json({ folders: [folder] })))
})

describe('FolderNavigation', () => {
  it('clicking a folder shows its heading', async () => {
    renderApp()
    await userEvent.click(await within(screen.getByTestId('sidebar')).findByText('People'))
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument()
  })

  it('clicking Home after a folder returns the Home heading', async () => {
    renderApp()
    await userEvent.click(await within(screen.getByTestId('sidebar')).findByText('People'))
    await userEvent.click(screen.getByTestId('home-button'))
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('folder view hides the todo section', async () => {
    renderApp()
    await userEvent.click(await within(screen.getByTestId('sidebar')).findByText('People'))
    // TodoSection is conditionally unmounted (not CSS-hidden) when in a folder view
    expect(screen.queryByTestId('todo-section')).not.toBeInTheDocument()
  })

  it('home view shows the todo section', async () => {
    renderApp()
    expect(await screen.findByTestId('todo-section')).toBeInTheDocument()
  })

  it('unfiled notes button is always visible in the sidebar', async () => {
    renderApp()
    expect(await screen.findByTestId('unfiled-notes-button')).toBeInTheDocument()
  })

  it('» button is visible next to Unfiled Notes', async () => {
    renderApp()
    expect(await screen.findByTestId('unfiled-preview-button')).toBeInTheDocument()
  })

  it('CHANGE-11: the unfiled preview button toggles » ↔ « and opens/closes the panel', async () => {
    renderApp()
    const btn = await screen.findByTestId('unfiled-preview-button')
    expect(btn).toHaveTextContent('»')
    // Panel is present but closed (no --open class) before any interaction.
    expect(screen.getByTestId('folder-preview-panel')).not.toHaveClass(folderPreviewStyles.folderPreviewPanelOpen)
    // Open the preview — button flips to « and the panel opens.
    await userEvent.click(btn)
    await waitFor(() =>
      expect(screen.getByTestId('folder-preview-panel')).toHaveClass(folderPreviewStyles.folderPreviewPanelOpen),
    )
    expect(screen.getByTestId('unfiled-preview-button')).toHaveTextContent('«')
    // Click again — panel closes and the button returns to ».
    await userEvent.click(screen.getByTestId('unfiled-preview-button'))
    await waitFor(() =>
      expect(screen.getByTestId('folder-preview-panel')).not.toHaveClass(folderPreviewStyles.folderPreviewPanelOpen),
    )
    expect(screen.getByTestId('unfiled-preview-button')).toHaveTextContent('»')
  })
})
