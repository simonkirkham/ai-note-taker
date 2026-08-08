import '@testing-library/jest-dom'
import { webcrypto } from 'node:crypto'
import { setupServer } from 'msw/node'
import { retryConfig } from '../api/client'
import { resetStaleDetailTrackingForTests } from '../hooks/useNoteDetail'
import { resetWorkspaceForTests } from '../workspace/workspaceStore'
import { handlers } from './handlers'

// BUG-47: jsdom's `crypto` stub has no `subtle`, so `crypto.subtle.digest` (the content hash) is
// undefined under vitest. Real browsers run in a secure context (HTTPS/localhost) where it exists;
// restore Node's Web Crypto in tests so the content-hash guard is exercised as it is in the browser.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
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
