import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { clearToken, setToken } from '../auth/tokenStore'
import { server } from '../test/setup'

beforeEach(() => clearToken())
afterEach(() => clearToken())

describe('unauthenticated state', () => {
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id'))
  afterEach(() => vi.unstubAllEnvs())

  it('shows sign-in screen and hides the note list', () => {
    render(<AuthProvider><App /></AuthProvider>)
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument()
  })
})

describe('no-auth bypass', () => {
  it('shows home screen without a token when VITE_GOOGLE_CLIENT_ID is absent', () => {
    render(<AuthProvider><App /></AuthProvider>)
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument()
  })
})

describe('authenticated state', () => {
  it('shows the home screen instead of the sign-in screen', () => {
    render(<AuthProvider initialToken="fake-id-token"><App /></AuthProvider>)
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument()
  })
})

describe('API calls', () => {
  it('include Authorization Bearer header when a token is set', async () => {
    let capturedAuth: string | null = null
    server.use(
      http.get('/api/notes', ({ request }) => {
        capturedAuth = request.headers.get('Authorization')
        return HttpResponse.json({ items: [] })
      }),
    )
    setToken('test-id-token')
    const { listNotes } = await import('../api/notes')
    await listNotes()
    expect(capturedAuth).toBe('Bearer test-id-token')
  })

  it('omit Authorization header when no token is set', async () => {
    let capturedAuth: string | null | undefined = undefined
    server.use(
      http.get('/api/notes', ({ request }) => {
        capturedAuth = request.headers.get('Authorization')
        return HttpResponse.json({ items: [] })
      }),
    )
    const { listNotes } = await import('../api/notes')
    await listNotes()
    expect(capturedAuth).toBeNull()
  })
})

describe('sign-out', () => {
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id'))
  afterEach(() => vi.unstubAllEnvs())

  it('clears the token and shows the sign-in screen', async () => {
    render(<AuthProvider initialToken="fake-id-token"><App /></AuthProvider>)
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })
})
