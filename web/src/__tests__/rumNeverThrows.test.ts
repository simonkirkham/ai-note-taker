import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordRumEvent, reportResourceError } from '../rum'

// BUG-74: `cwr` is a global installed by a third-party snippet, so both entry points can throw.
// They are called almost exclusively from catch blocks — teardown, corrupt-storage handling, auth
// callbacks — where a throwing diagnostic re-creates the fault it is reporting. That is literally
// how this bug got one round longer: the fix guarded the on-device teardown and then emitted the
// failure from inside the guard, putting a fresh unguarded throw on the pre-commit path.
//
// Pinned directly here as well as through the hook, because a three-line unit test outlives a
// sixty-line composition test.

afterEach(() => vi.unstubAllGlobals())

describe('RUM reporting never breaks its caller (BUG-74)', () => {
  it('swallows a throwing recordEvent', () => {
    vi.stubGlobal('cwr', () => {
      throw new Error('the RUM client blew up')
    })
    expect(() => recordRumEvent('anything', { a: 1 })).not.toThrow()
  })

  it('swallows a throwing recordError', () => {
    vi.stubGlobal('cwr', () => {
      throw new Error('the RUM client blew up')
    })
    const img = document.createElement('img')
    img.src = 'https://example.com/missing.png'
    expect(() => reportResourceError({ target: img } as unknown as Event)).not.toThrow()
  })
})
