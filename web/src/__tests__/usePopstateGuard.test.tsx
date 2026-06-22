import { act, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { usePopstateGuard } from '../hooks/usePopstateGuard'

// Drive the guard via a tiny harness: a checkbox-free component whose `when`
// flag and onAttempt spy the test controls. The guard must intercept a browser
// Back press (popstate) while armed and route it through onAttempt instead of
// letting the navigation through.

function Harness({ when, onAttempt }: { when: boolean; onAttempt: () => void }) {
  usePopstateGuard(when, onAttempt)
  return null
}

beforeEach(() => {
  window.history.replaceState({}, '', '/w/ws-1/notes/note-1')
})

it('does NOT intercept popstate when disarmed', () => {
  const onAttempt = vi.fn()
  render(<Harness when={false} onAttempt={onAttempt} />)

  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  expect(onAttempt).not.toHaveBeenCalled()
})

it('intercepts a browser Back press (popstate) while armed and calls onAttempt', () => {
  const onAttempt = vi.fn()
  render(<Harness when={true} onAttempt={onAttempt} />)

  // Simulate the user pressing browser Back: the sentinel entry is popped, firing
  // popstate. The guard must catch it (not let the note unmount) and call onAttempt.
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  expect(onAttempt).toHaveBeenCalledTimes(1)
})

it('re-arms after each intercepted Back so a second Back is also caught', () => {
  const onAttempt = vi.fn()
  render(<Harness when={true} onAttempt={onAttempt} />)

  act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })

  expect(onAttempt).toHaveBeenCalledTimes(2)
})

it('stops intercepting once disarmed (e.g. recording stopped)', () => {
  const onAttempt = vi.fn()
  function Toggle() {
    const [armed, setArmed] = useState(true)
    usePopstateGuard(armed, onAttempt)
    return <button onClick={() => setArmed(false)}>disarm</button>
  }
  const { getByText } = render(<Toggle />)

  act(() => { getByText('disarm').click() })
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })

  expect(onAttempt).not.toHaveBeenCalled()
})

it('disarming (e.g. Stop) pops its sentinel so the next Back is not swallowed', () => {
  const onAttempt = vi.fn()
  // jsdom does not decrement history.length on back(), so assert the contract via a
  // spy: disarming WITHOUT leaving must pop the sentinel it pushed on arm.
  const backSpy = vi.spyOn(window.history, 'back')
  function Toggle() {
    const [armed, setArmed] = useState(true)
    usePopstateGuard(armed, onAttempt)
    return <button onClick={() => setArmed(false)}>disarm</button>
  }
  const { getByText } = render(<Toggle />)

  expect(backSpy).not.toHaveBeenCalled() // arming alone does not pop
  act(() => { getByText('disarm').click() })
  expect(backSpy).toHaveBeenCalledTimes(1) // sentinel reconciled away on disarm
  backSpy.mockRestore()
})

it('confirmLeave runs the proceed navigation and does NOT re-trigger onAttempt', async () => {
  const onAttempt = vi.fn()
  const proceed = vi.fn()
  function LeaveHarness() {
    const { confirmLeave } = usePopstateGuard(true, onAttempt)
    return <button onClick={() => confirmLeave(proceed)}>leave</button>
  }
  const { getByText } = render(<LeaveHarness />)

  act(() => { getByText('leave').click() })

  // confirmLeave pops the sentinel (history.back fires popstate async) and then runs
  // proceed; the sentinel pop must be swallowed, never surfacing as a leave-attempt.
  await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1))
  expect(onAttempt).not.toHaveBeenCalled()
})
