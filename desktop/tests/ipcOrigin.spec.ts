import { test, expect } from '@playwright/test'
import { isBundleOrigin } from '../src/ipcOrigin'

// 53-A — the desktop window also visits Google's sign-in pages, which get the same preload. The
// update-notice calls must answer only the app's own origin.
const ORIGINS = ['http://localhost:5180', 'http://127.0.0.1:5180']

test('the app on localhost is allowed', () => {
  expect(isBundleOrigin('http://localhost:5180/notes/abc', ORIGINS)).toBe(true)
})

test('the app on 127.0.0.1 is allowed', () => {
  expect(isBundleOrigin('http://127.0.0.1:5180/', ORIGINS)).toBe(true)
})

test("Google's sign-in page is refused", () => {
  expect(isBundleOrigin('https://accounts.google.com/o/oauth2/v2/auth', ORIGINS)).toBe(false)
})

test('another localhost port is refused', () => {
  expect(isBundleOrigin('http://localhost:5181/', ORIGINS)).toBe(false)
})

test('no frame URL is refused', () => {
  expect(isBundleOrigin(undefined, ORIGINS)).toBe(false)
  expect(isBundleOrigin('', ORIGINS)).toBe(false)
})

test('an unparseable URL is refused', () => {
  expect(isBundleOrigin('not a url', ORIGINS)).toBe(false)
})
