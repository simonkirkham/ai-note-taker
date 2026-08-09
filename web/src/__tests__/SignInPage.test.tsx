import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../auth/context'
import SignInPage from '../components/SignInPage'

function renderWithSignIn(signIn = vi.fn()) {
  render(
    <AuthContext.Provider
      value={{
        idToken: null,
        forbidden: false,
        sessionExpired: false,
        authLoading: false,
        storageBlocked: false,
        signIn,
        signOut: () => {},
      }}
    >
      <SignInPage />
    </AuthContext.Provider>,
  )
  return signIn
}

describe('SignInPage', () => {
  it('renders the app title', () => {
    renderWithSignIn()
    expect(screen.getByRole('heading', { name: /ai note taker/i })).toBeInTheDocument()
  })

  it('renders a "Sign in with Google" button', () => {
    renderWithSignIn()
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('calls the auth signIn handler when the button is clicked', async () => {
    const signIn = renderWithSignIn()
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(signIn).toHaveBeenCalledTimes(1)
  })
})
