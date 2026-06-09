import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AuthProvider } from '../auth/AuthContext'
import { useAuth, type AuthState } from '../auth/context'
import { useToast, type ToastContextValue } from '../components/toastContext'
import { ToastProvider } from '../components/ToastProvider'

// The provider is rendered inline inside a stateful harness so that bumping the
// harness counter re-creates the provider element and forces it to re-render
// (passing the provider as a stable `children` prop would let React skip it).
// An unmemoised value literal would then hand consumers a fresh object — and fresh
// action functions — on every such re-render, re-rendering the whole consumer tree.

describe('AuthProvider value memoization', () => {
  it('keeps the context value (and actions) referentially stable across a re-render with unchanged auth state', async () => {
    const values: AuthState[] = []
    function Capture() {
      values.push(useAuth())
      return null
    }
    function Harness() {
      const [n, setN] = useState(0)
      return (
        <>
          <button onClick={() => setN((v) => v + 1)}>bump {n}</button>
          <AuthProvider initialToken="tok">
            <Capture />
          </AuthProvider>
        </>
      )
    }

    render(<Harness />)

    const first = values.at(-1)!
    await userEvent.click(screen.getByRole('button', { name: /bump/ }))
    const afterRerender = values.at(-1)!

    expect(values.length).toBeGreaterThan(1)
    expect(afterRerender).toBe(first)
    expect(afterRerender.signIn).toBe(first.signIn)
    expect(afterRerender.signOut).toBe(first.signOut)
  })
})

describe('ToastProvider value memoization', () => {
  it('keeps the context value referentially stable across a re-render', async () => {
    const values: ToastContextValue[] = []
    function Capture() {
      values.push(useToast())
      return null
    }
    function Harness() {
      const [n, setN] = useState(0)
      return (
        <>
          <button onClick={() => setN((v) => v + 1)}>bump {n}</button>
          <ToastProvider>
            <Capture />
          </ToastProvider>
        </>
      )
    }

    render(<Harness />)

    const first = values.at(-1)!
    await userEvent.click(screen.getByRole('button', { name: /bump/ }))
    const afterRerender = values.at(-1)!

    expect(values.length).toBeGreaterThan(1)
    expect(afterRerender).toBe(first)
  })
})
