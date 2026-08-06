import { test, expect } from '@playwright/test'
import { decidePermissionCheck, decidePermissionRequest } from '../src/permissionPolicy'

// CHANGE-32 — the pure permission decision behind the desktop mic pin. Unit-tested with no
// Electron and no real session, the same headless seam as displayMedia.spec.ts /
// spellCheckMenu.spec.ts.
const ORIGINS = ['http://localhost:5180', 'http://127.0.0.1:5180']
const APP_URL = 'http://localhost:5180/notes/abc'

// --- setPermissionRequestHandler ------------------------------------------------------

test('microphone request from the bundle origin is granted', () => {
  const d = decidePermissionRequest(
    { permission: 'media', requestingUrl: APP_URL, mediaTypes: ['audio'] },
    ORIGINS,
  )
  expect(d.allow).toBe(true)
})

test('the alternate loopback host is also the bundle origin', () => {
  const d = decidePermissionRequest(
    { permission: 'media', requestingUrl: 'http://127.0.0.1:5180/', mediaTypes: ['audio'] },
    ORIGINS,
  )
  expect(d.allow).toBe(true)
})

// A blanket callback(true) would pass every other test here; this is the one that fails it.
test('media from any other origin is denied — the pin is an allow-list, not a blanket grant', () => {
  for (const url of [
    'https://accounts.google.com/o/oauth2/auth',
    'https://note-taker-ai.com/',
    'http://localhost:3000/', // right host, wrong port — a stray local server is not the bundle
    'https://evil.example/',
  ]) {
    const d = decidePermissionRequest({ permission: 'media', requestingUrl: url, mediaTypes: ['audio'] }, ORIGINS)
    expect(d.allow, `expected ${url} to be denied`).toBe(false)
  }
})

test('a malformed requesting URL is denied rather than treated as the bundle origin', () => {
  expect(decidePermissionRequest({ permission: 'media', requestingUrl: 'not a url', mediaTypes: ['audio'] }, ORIGINS).allow).toBe(false)
  expect(decidePermissionRequest({ permission: 'media', requestingUrl: '', mediaTypes: ['audio'] }, ORIGINS).allow).toBe(false)
})

// The app has no camera feature; a video-only request is not something it ever makes.
test('a camera-only request from the bundle origin is denied', () => {
  const d = decidePermissionRequest({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['video'] }, ORIGINS)
  expect(d.allow).toBe(false)
})

// Screen capture reaches Electron with no device mediaTypes; denying an unspecified media
// request would kill 31-B's system-audio path.
test('a media request with unspecified media types is granted (the screen-capture path)', () => {
  expect(decidePermissionRequest({ permission: 'media', requestingUrl: APP_URL }, ORIGINS).allow).toBe(true)
  expect(decidePermissionRequest({ permission: 'media', requestingUrl: APP_URL, mediaTypes: [] }, ORIGINS).allow).toBe(true)
})

test('screen-capture and audio+video together are granted for the bundle origin', () => {
  expect(decidePermissionRequest({ permission: 'display-capture', requestingUrl: APP_URL }, ORIGINS).allow).toBe(true)
  expect(decidePermissionRequest({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['video', 'audio'] }, ORIGINS).allow).toBe(true)
})

// Meeting reminders call Notification.requestPermission(); denying it would be a regression.
test('notifications from the bundle origin are granted (meeting reminders)', () => {
  expect(decidePermissionRequest({ permission: 'notifications', requestingUrl: APP_URL }, ORIGINS).allow).toBe(true)
})

test('screen-capture and notifications from another origin are denied', () => {
  const url = 'https://accounts.google.com/'
  expect(decidePermissionRequest({ permission: 'display-capture', requestingUrl: url }, ORIGINS).allow).toBe(false)
  expect(decidePermissionRequest({ permission: 'notifications', requestingUrl: url }, ORIGINS).allow).toBe(false)
})

test('every other permission is denied even from the bundle origin', () => {
  for (const permission of ['geolocation', 'midiSysex', 'openExternal', 'usb', 'serial', 'hid', 'idle-detection', 'fileSystem', 'unknown']) {
    const d = decidePermissionRequest({ permission, requestingUrl: APP_URL }, ORIGINS)
    expect(d.allow, `expected ${permission} to be denied`).toBe(false)
  }
})

// The reason is what main.ts logs; an empty one makes a future regression invisible.
test('every decision carries a non-empty reason for the log line', () => {
  const decisions = [
    decidePermissionRequest({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['audio'] }, ORIGINS),
    decidePermissionRequest({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['video'] }, ORIGINS),
    decidePermissionRequest({ permission: 'geolocation', requestingUrl: APP_URL }, ORIGINS),
    decidePermissionRequest({ permission: 'media', requestingUrl: 'https://evil.example/' }, ORIGINS),
    decidePermissionCheck({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'audio' }, ORIGINS),
  ]
  for (const d of decisions) expect(d.reason.length).toBeGreaterThan(0)
})

// --- setPermissionCheckHandler --------------------------------------------------------
// Electron requires BOTH handlers: the request handler answers a prompt, the check handler
// answers a synchronous "do I already have this?" (navigator.permissions.query,
// enumerateDevices labels, and Chromium's own pre-flight before getUserMedia).

test('the check handler grants an audio media check from the bundle origin', () => {
  expect(decidePermissionCheck({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'audio' }, ORIGINS).allow).toBe(true)
})

test('the check handler treats an unknown media type as the audio/screen-capture path', () => {
  expect(decidePermissionCheck({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'unknown' }, ORIGINS).allow).toBe(true)
  expect(decidePermissionCheck({ permission: 'media', requestingOrigin: 'http://localhost:5180' }, ORIGINS).allow).toBe(true)
})

test('the check handler denies a camera check', () => {
  expect(decidePermissionCheck({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'video' }, ORIGINS).allow).toBe(false)
})

test('the check handler denies any other origin, including an empty one', () => {
  expect(decidePermissionCheck({ permission: 'media', requestingOrigin: 'https://accounts.google.com', mediaType: 'audio' }, ORIGINS).allow).toBe(false)
  expect(decidePermissionCheck({ permission: 'media', requestingOrigin: '', mediaType: 'audio' }, ORIGINS).allow).toBe(false)
})

test('the check handler denies unlisted permissions from the bundle origin', () => {
  for (const permission of ['geolocation', 'clipboard-read', 'midiSysex', 'serial', 'usb']) {
    const d = decidePermissionCheck({ permission, requestingOrigin: 'http://localhost:5180' }, ORIGINS)
    expect(d.allow, `expected ${permission} to be denied`).toBe(false)
  }
})

test('the check handler grants notifications from the bundle origin', () => {
  expect(decidePermissionCheck({ permission: 'notifications', requestingOrigin: 'http://localhost:5180' }, ORIGINS).allow).toBe(true)
})
