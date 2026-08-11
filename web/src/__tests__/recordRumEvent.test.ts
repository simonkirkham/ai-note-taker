import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordRumEvent } from '../rum'

type CwrFn = (operation: string, ...args: unknown[]) => void

function setCwr(fn: CwrFn): void {
  ;(window as unknown as { cwr?: CwrFn }).cwr = fn
}

afterEach(() => {
  delete (window as unknown as { cwr?: CwrFn }).cwr
  vi.restoreAllMocks()
})

describe('recordRumEvent', () => {
  it('passes type and data as ONE payload object, not as positional arguments', () => {
    const cwr = vi.fn()
    setCwr(cwr)

    recordRumEvent('deadNoteLink', { noteId: 'note-1' })

    expect(cwr.mock.calls[0]).toEqual([
      'recordEvent',
      { type: 'deadNoteLink', data: { noteId: 'note-1' } },
    ])
  })

  it('satisfies the deployed client parameter guard, so the event actually reaches RUM', () => {
    // Mirrors cwr.js 3.x, the build the deploy workflow injects. Two things matter and
    // neither is visible from a vi.fn(): the global is installed as `(c, p) => push({c, p})`,
    // so a THIRD argument is silently dropped; and `recordEvent` rejects anything that is
    // not `{type: string, data: object}`. recordRumEvent swallows throws (BUG-74), so a
    // rejected call looks exactly like a successful one — assert what was received.
    let received: unknown
    setCwr((command: string, payload: unknown) => {
      if (command !== 'recordEvent') return
      const event = payload as { type?: unknown; data?: unknown }
      if (
        typeof event !== 'object' ||
        event === null ||
        typeof event.type !== 'string' ||
        typeof event.data !== 'object'
      ) {
        throw new Error('IncorrectParametersException')
      }
      received = event
    })

    recordRumEvent('tabRestoreFailed', { reason: 'corrupt' })

    expect(received).toEqual({ type: 'tabRestoreFailed', data: { reason: 'corrupt' } })
  })

  it('stays silent when the RUM client is absent', () => {
    expect(() => recordRumEvent('noteTabOpened', { tabCount: 2 })).not.toThrow()
  })
})
