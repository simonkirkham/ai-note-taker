import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../auth/context'
import SignInPage from '../components/SignInPage'

function renderWithSignIn(signIn = vi.fn(), storageBlocked = false) {
  render(
    <AuthContext.Provider
      value={{
        idToken: null,
        forbidden: false,
        sessionExpired: false,
        authLoading: false,
        storageBlocked,
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

  // BUG-60: the user-visible half of the storage-refusal fix. Review found the whole message block
  // could be deleted with 981 tests still green — the redirect suite asserts through its own probe
  // component and never renders the real SignInPage.
  it('explains why sign-in cannot proceed when the browser refuses storage', () => {
    renderWithSignIn(vi.fn(), true)
    expect(screen.getByTestId('storage-blocked-message')).toHaveTextContent(/didn’t keep the data/i)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('says nothing about storage when sign-in is available as normal', () => {
    renderWithSignIn()
    expect(screen.queryByTestId('storage-blocked-message')).toBeNull()
  })
})
