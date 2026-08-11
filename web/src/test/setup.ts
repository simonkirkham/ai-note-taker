import '@testing-library/jest-dom'
import { webcrypto } from 'node:crypto'
import { configure } from '@testing-library/react'
import { setupServer } from 'msw/node'
import { retryConfig } from '../api/client'
import { resetStaleCardsTrackingForTests } from '../hooks/useNoteCards'
import { resetStaleDetailTrackingForTests } from '../hooks/useNoteDetail'
import { resetDeletedNoteRescueForTests } from '../lib/deletedNoteRescue'
import { resetWorkspaceForTests } from '../workspace/workspaceStore'
import { handlers } from './handlers'

// BUG-47: jsdom's `crypto` stub has no `subtle`, so `crypto.subtle.digest` (the content hash) is
// undefined under vitest. Real browsers run in a secure context (HTTPS/localhost) where it exists;
// restore Node's Web Crypto in tests so the content-hash guard is exercised as it is in the browser.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
}

// TI-61. Companion to `testTimeout` in vite.config.ts, for the same reason and local
// only. RTL's 1000 ms default is the budget a single `findBy*`/`waitFor` gets, and
// under contention it is exceeded before the per-test budget is: the first reproduction
// failed on `findByRole('heading', { name: 'Home' })` with "Unable to find role", not on
// a test timeout. Note the nominal budget already under-delivers — a wait measured at
// 1735 ms still SUCCEEDED against a nominal 1000 ms, because the deadline is only
// checked on a poll that starvation also delays.
// 4000 = longest wait measured that still succeeded (1735) x2, rounded up.
// CI keeps the 1000 ms default.
if (!process.env.CI) {
  configure({ asyncUtilTimeout: 4000 })
}

export const server = setupServer(...handlers)

// Zero the transient-retry backoff so GET error-state tests retry instantly instead
// of paying real wall-clock delay (the ApiFetch suite covers the backoff timing).
retryConfig.baseDelayMs = 0

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
// Routing is URL-based (Phase 21): jsdom's history URL persists across renders
// within a file, so reset it to "/" between tests or a folder/note URL from one
// test leaks into the next render's starting route. Guard window — some suites
// (e.g. Favicon) opt into the node environment where it is undefined.
afterEach(() => {
  if (typeof window !== 'undefined') window.history.replaceState({}, '', '/')
  // The active workspace is module-global state; clear it so a `/w/:wsId` set by a
  // full-App render in one test never leaks the path prefix into the next.
  resetWorkspaceForTests()
  // BUG-48: the note-detail stale-read tracker is module state too — same leak class.
  resetStaleDetailTrackingForTests()
  // TI-65: same class again for the cards-list stale-read hold budget.
  resetStaleCardsTrackingForTests()
  // BUG-59: the deleted-note rescue store is module state by design (it must survive unmount and
  // query invalidation), so it survives a test too — clear it or one test's banner shows in the next.
  resetDeletedNoteRescueForTests()
  // Same class again for browser storage — 49-B persists the open-note tabs there, so
  // without this a tab opened in one test is restored in the next and every count
  // assertion drifts. Covers the theme and keep-audio-local preferences too.
  // Cleared independently: a suite that stubs one of them to throw must not prevent the
  // other from being reset.
  if (typeof window !== 'undefined') {
    try {
      localStorage.clear()
    } catch {
      /* stubbed to throw by the test under way; nothing to clear */
    }
    try {
      sessionStorage.clear()
    } catch {
      /* ditto */
    }
  }
})
afterAll(() => server.close())
