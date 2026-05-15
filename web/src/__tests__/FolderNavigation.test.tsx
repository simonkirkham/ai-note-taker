import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import App from '../App'

const folder = { folderId: 'f-1', name: 'People', children: [] }

beforeEach(() => {
  // Persistent override (not one-shot); reset happens in global afterEach via server.resetHandlers()
  server.use(http.get('/folders', () => HttpResponse.json({ folders: [folder] })))
})

describe('FolderNavigation', () => {
  it('clicking a folder shows its heading', async () => {
    render(<App />)
    await userEvent.click(await within(screen.getByTestId('sidebar')).findByText('People'))
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument()
  })

  it('clicking Home after a folder returns the Home heading', async () => {
    render(<App />)
    await userEvent.click(await within(screen.getByTestId('sidebar')).findByText('People'))
    await userEvent.click(screen.getByTestId('home-button'))
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('folder view hides the todo section', async () => {
    render(<App />)
    await userEvent.click(await within(screen.getByTestId('sidebar')).findByText('People'))
    // TodoSection is conditionally unmounted (not CSS-hidden) when in a folder view
    expect(screen.queryByTestId('todo-section')).not.toBeInTheDocument()
  })

  it('home view shows the todo section', async () => {
    render(<App />)
    expect(await screen.findByTestId('todo-section')).toBeInTheDocument()
  })

  it('unfiled notes button is always visible in the sidebar', async () => {
    render(<App />)
    expect(await screen.findByTestId('unfiled-notes-button')).toBeInTheDocument()
  })
})
