import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearChunkReloadFlag,
  clearChunkReloadFlagAfterStable,
  installChunkReloadHandler,
} from '../lib/chunkReload'

interface FakeWindow {
  win: Window
  reload: ReturnType<typeof vi.fn>
  fire: () => { preventDefault: ReturnType<typeof vi.fn> }
  store: Map<string, string>
}

function makeWindow(seed?: Record<string, string>): FakeWindow {
  const listeners: Record<string, ((e: Event) => void)[]> = {}
  const store = new Map<string, string>(Object.entries(seed ?? {}))
  const reload = vi.fn()

  const win = {
    addEventListener: (type: string, cb: (e: Event) => void) => {
      ;(listeners[type] ??= []).push(cb)
    },
    sessionStorage: {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
    location: { reload },
  }

  const fire = (): { preventDefault: ReturnType<typeof vi.fn> } => {
    const evt = { preventDefault: vi.fn() }
    for (const cb of listeners['vite:preloadError'] ?? []) cb(evt as unknown as Event)
    return evt
  }

  return { win: win as unknown as Window, reload, fire, store }
}

describe('installChunkReloadHandler', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reloads exactly once on the first vite:preloadError and suppresses the default throw', () => {
    const { win, reload, fire } = makeWindow()
    installChunkReloadHandler(win)

    const evt = fire()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(evt.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not reload again once the guard flag is set (no reload loop)', () => {
    const { win, reload, fire } = makeWindow()
    installChunkReloadHandler(win)

    fire() // first incident: reload + set flag
    const second = fire() // flag now set

    expect(reload).toHaveBeenCalledTimes(1)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('lets a later incident self-heal once the flag is cleared on a successful load', () => {
    const { win, reload, fire } = makeWindow()
    installChunkReloadHandler(win)

    fire() // reload + set flag
    clearChunkReloadFlag(win) // app booted successfully → reset
    const third = fire() // a fresh incident later

    expect(reload).toHaveBeenCalledTimes(2)
    expect(third.preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('clearChunkReloadFlag', () => {
  it('removes the guard flag from sessionStorage', () => {
    const { win, store } = makeWindow({ 'chunk-reload-attempted': '1' })

    clearChunkReloadFlag(win)

    expect(store.has('chunk-reload-attempted')).toBe(false)
  })
})

// 19-I1: with React.lazy routes the entry chunk evaluating no longer proves
// every lazy chunk loaded, so clearing the flag synchronously at boot re-arms
// the guard before a later lazy-chunk failure — risking a reload loop. The flag
// must clear only after the app has run stably for a delay.
describe('clearChunkReloadFlagAfterStable', () => {
  afterEach(() => vi.useRealTimers())

  it('does not clear the flag immediately', () => {
    vi.useFakeTimers()
    const { win, store } = makeWindow({ 'chunk-reload-attempted': '1' })

    clearChunkReloadFlagAfterStable(win, 10_000)

    expect(store.has('chunk-reload-attempted')).toBe(true)
  })

  it('clears the flag once the stability delay elapses', () => {
    vi.useFakeTimers()
    const { win, store } = makeWindow({ 'chunk-reload-attempted': '1' })

    clearChunkReloadFlagAfterStable(win, 10_000)
    vi.advanceTimersByTime(10_000)

    expect(store.has('chunk-reload-attempted')).toBe(false)
  })

  it('a lazy-chunk failure within the stability window falls through to the boundary (no reload loop)', () => {
    vi.useFakeTimers()
    const { win, reload, fire } = makeWindow()
    installChunkReloadHandler(win)

    fire() // first incident: reload + set flag
    clearChunkReloadFlagAfterStable(win, 10_000) // boot — but do NOT clear yet
    const second = fire() // a lazy chunk fails again before the window elapses

    expect(reload).toHaveBeenCalledTimes(1) // no second reload
    expect(second.preventDefault).not.toHaveBeenCalled() // falls through to ErrorBoundary
  })
})
