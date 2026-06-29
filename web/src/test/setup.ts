import '@testing-library/jest-dom'
import { setupServer } from 'msw/node'
import { retryConfig } from '../api/client'
import { resetWorkspaceForTests } from '../workspace/workspaceStore'
import { handlers } from './handlers'

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
})
afterAll(() => server.close())
