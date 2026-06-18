import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from '../components/ErrorBoundary'

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React logs the caught error to console.error; suppress the expected noise.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('renders the fallback when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('renders the recoverable fallback when a dynamic-import chunk fails to load', () => {
    function ChunkBoom(): never {
      // Mirrors the error React surfaces when a React.lazy import 404s after a deploy.
      throw new Error('Failed to fetch dynamically imported module: /assets/Page-abc123.js')
    }

    render(
      <ErrorBoundary>
        <ChunkBoom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>healthy content</div>
      </ErrorBoundary>,
    )

    expect(screen.getByText('healthy content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders a custom fallback instead of the default when one is provided', () => {
    render(
      <ErrorBoundary fallback={<div role="alert">custom fallback</div>}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('custom fallback')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('invokes onError with the caught error when a child throws', () => {
    const onError = vi.fn()

    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('boom')
  })
})
