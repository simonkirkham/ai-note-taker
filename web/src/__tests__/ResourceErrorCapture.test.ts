import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installResourceErrorHandler, reportResourceError } from '../rum'

type CwrFn = (operation: string, ...args: unknown[]) => void

function withCwr(): ReturnType<typeof vi.fn> {
  const cwr = vi.fn()
  ;(window as unknown as { cwr?: CwrFn }).cwr = cwr
  return cwr
}

afterEach(() => {
  delete (window as unknown as { cwr?: CwrFn }).cwr
  vi.restoreAllMocks()
})

describe('reportResourceError', () => {
  it('forwards a resource-element load failure to RUM recordError', () => {
    const cwr = withCwr()
    const img = document.createElement('img')
    img.src = 'https://example.com/bad.png'
    const evt = { target: img } as unknown as Event

    reportResourceError(evt)

    expect(cwr).toHaveBeenCalledTimes(1)
    const [op, err] = cwr.mock.calls[0]
    expect(op).toBe('recordError')
    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message).toContain('IMG')
    expect(message).toContain('https://example.com/bad.png')
    expect(message).toContain(window.location.pathname)
  })

  it('does NOT report a window-level (JS) error — already covered by the errors telemetry', () => {
    const cwr = withCwr()
    // A genuine uncaught JS error: target is the window, not an element with src/href.
    const evt = { target: window } as unknown as Event

    reportResourceError(evt)

    expect(cwr).not.toHaveBeenCalled()
  })

  it('does not report an element with neither src nor href', () => {
    const cwr = withCwr()
    const div = document.createElement('div')
    const evt = { target: div } as unknown as Event

    reportResourceError(evt)

    expect(cwr).not.toHaveBeenCalled()
  })

  it('reports a stylesheet link failure via its href', () => {
    const cwr = withCwr()
    const link = document.createElement('link')
    link.href = 'https://example.com/missing.css'
    const evt = { target: link } as unknown as Event

    reportResourceError(evt)

    expect(cwr).toHaveBeenCalledTimes(1)
    const message = (cwr.mock.calls[0][1] as Error).message
    expect(message).toContain('LINK')
    expect(message).toContain('https://example.com/missing.css')
  })

  it('is a no-op when window.cwr is absent (local/tests)', () => {
    delete (window as unknown as { cwr?: CwrFn }).cwr
    const img = document.createElement('img')
    img.src = 'https://example.com/bad.png'
    expect(() => reportResourceError({ target: img } as unknown as Event)).not.toThrow()
  })
})

describe('installResourceErrorHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('registers an error listener in the capture phase', () => {
    const add = vi.spyOn(window, 'addEventListener')
    installResourceErrorHandler()
    const errorReg = add.mock.calls.find((c) => c[0] === 'error')
    expect(errorReg).toBeDefined()
    // 3rd arg MUST be true — resource-load failures only surface in capture phase.
    expect(errorReg?.[2]).toBe(true)
  })

  it('forwards a dispatched resource error event to RUM', () => {
    const cwr = withCwr()
    installResourceErrorHandler()

    const img = document.createElement('img')
    img.src = 'https://example.com/dispatched.png'
    document.body.appendChild(img)
    // Dispatch on the element with capture-phase observation at window.
    img.dispatchEvent(new Event('error', { bubbles: false }))

    expect(cwr).toHaveBeenCalledTimes(1)
    expect((cwr.mock.calls[0][1] as Error).message).toContain('https://example.com/dispatched.png')
    document.body.removeChild(img)
  })
})
