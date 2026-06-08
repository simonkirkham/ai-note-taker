import '@testing-library/jest-dom'
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
// Routing is URL-based (Phase 21): jsdom's history URL persists across renders
// within a file, so reset it to "/" between tests or a folder/note URL from one
// test leaks into the next render's starting route. Guard window — some suites
// (e.g. Favicon) opt into the node environment where it is undefined.
afterEach(() => {
  if (typeof window !== 'undefined') window.history.replaceState({}, '', '/')
})
afterAll(() => server.close())
