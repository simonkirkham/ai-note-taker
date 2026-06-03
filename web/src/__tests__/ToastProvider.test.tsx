import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from '../components/ToastProvider'

function Consumer() {
  const { showToast, showError } = useToast()
  return (
    <div>
      <button onClick={() => showToast('info message')}>show info</button>
      <button onClick={() => showError('error message')}>show error</button>
    </div>
  )
}

function renderConsumer() {
  return render(
    <ToastProvider>
      <Consumer />
    </ToastProvider>,
  )
}

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an info toast in a polite live region', async () => {
    const user = userEvent.setup()
    renderConsumer()

    await user.click(screen.getByRole('button', { name: 'show info' }))

    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('info message')
  })

  it('shows an error toast as an alert', async () => {
    const user = userEvent.setup()
    renderConsumer()

    await user.click(screen.getByRole('button', { name: 'show error' }))

    expect(screen.getByRole('alert')).toHaveTextContent('error message')
  })

  it('removes a toast when its dismiss button is clicked', async () => {
    const user = userEvent.setup()
    renderConsumer()

    await user.click(screen.getByRole('button', { name: 'show info' }))
    expect(screen.getByText('info message')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('info message')).not.toBeInTheDocument()
  })

  it('auto-dismisses a toast after the timeout', () => {
    vi.useFakeTimers()
    renderConsumer()

    fireEvent.click(screen.getByRole('button', { name: 'show info' }))
    expect(screen.getByText('info message')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.queryByText('info message')).not.toBeInTheDocument()
  })

  it('throws when useToast is used outside a provider', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/useToast must be used within a ToastProvider/)
    consoleErrorSpy.mockRestore()
  })
})
