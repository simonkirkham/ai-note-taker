import { test, expect } from '@playwright/test'
import {
  decidePermissionCheck,
  decidePermissionRequest,
  type PermissionCheckQuery,
  type PermissionRequestQuery,
} from '../src/permissionPolicy'

// CHANGE-32 — the pure permission decision behind the desktop mic pin. Unit-tested with no
// Electron and no real session, the same headless seam as displayMedia.spec.ts /
// spellCheckMenu.spec.ts.
//
// CAVEAT worth knowing before trusting a green run: these specs assert against the shapes we
// BELIEVE Electron passes. They cannot prove the wire format itself. That gap is exactly where
// the first review found a live bug — the check handler receives a GURL spec WITH a trailing
// slash, and the original code compared it raw, denying every check while all 17 specs passed.
// The trailing-slash cases below pin that; MANUAL-VERIFICATION #6 covers what specs cannot.
const ORIGINS = ['http://localhost:5180', 'http://127.0.0.1:5180']
const APP_URL = 'http://localhost:5180/notes/abc'

// Both handlers now take isMainFrame; default it to true so each test states only what it varies.
const req = (q: Omit<PermissionRequestQuery, 'isMainFrame'> & { isMainFrame?: boolean }) =>
  decidePermissionRequest({ isMainFrame: true, ...q }, ORIGINS)
const chk = (q: Omit<PermissionCheckQuery, 'isMainFrame'> & { isMainFrame?: boolean }) =>
  decidePermissionCheck({ isMainFrame: true, ...q }, ORIGINS)

// --- setPermissionRequestHandler ------------------------------------------------------

test('microphone request from the bundle origin is granted', () => {
  expect(req({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['audio'] }).allow).toBe(true)
})

test('the alternate loopback host is also the bundle origin', () => {
  expect(req({ permission: 'media', requestingUrl: 'http://127.0.0.1:5180/', mediaTypes: ['audio'] }).allow).toBe(true)
})

// A blanket callback(true) would pass every other test here; this is the one that fails it.
test('media from any other origin is denied — the pin is an allow-list, not a blanket grant', () => {
  for (const url of [
    'https://accounts.google.com/o/oauth2/auth',
    'https://note-taker-ai.com/',
    'http://localhost:3000/', // right host, wrong port — a stray local server is not the bundle
    'https://evil.example/',
  ]) {
    expect(req({ permission: 'media', requestingUrl: url, mediaTypes: ['audio'] }).allow, `expected ${url} to be denied`).toBe(false)
  }
})

test('a malformed requesting URL is denied rather than treated as the bundle origin', () => {
  expect(req({ permission: 'media', requestingUrl: 'not a url', mediaTypes: ['audio'] }).allow).toBe(false)
  expect(req({ permission: 'media', requestingUrl: '', mediaTypes: ['audio'] }).allow).toBe(false)
})

// The app has no camera feature; a video-only request is not something it ever makes.
test('a camera-only request from the bundle origin is denied', () => {
  expect(req({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['video'] }).allow).toBe(false)
})

// Screen capture reaches Electron with no device mediaTypes; denying an unspecified media
// request would kill 31-B's system-audio path.
test('a media request with unspecified media types is granted (the screen-capture path)', () => {
  expect(req({ permission: 'media', requestingUrl: APP_URL }).allow).toBe(true)
  expect(req({ permission: 'media', requestingUrl: APP_URL, mediaTypes: [] }).allow).toBe(true)
})

test('screen-capture and audio+video together are granted for the bundle origin', () => {
  expect(req({ permission: 'display-capture', requestingUrl: APP_URL }).allow).toBe(true)
  expect(req({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['video', 'audio'] }).allow).toBe(true)
})

// Meeting reminders call Notification.requestPermission(); denying it would be a regression.
test('notifications from the bundle origin are granted (meeting reminders)', () => {
  expect(req({ permission: 'notifications', requestingUrl: APP_URL }).allow).toBe(true)
})

test('screen-capture and notifications from another origin are denied', () => {
  const url = 'https://accounts.google.com/'
  expect(req({ permission: 'display-capture', requestingUrl: url }).allow).toBe(false)
  expect(req({ permission: 'notifications', requestingUrl: url }).allow).toBe(false)
})

test('every other permission is denied even from the bundle origin', () => {
  for (const permission of ['geolocation', 'midiSysex', 'openExternal', 'usb', 'serial', 'hid', 'idle-detection', 'fileSystem', 'unknown']) {
    expect(req({ permission, requestingUrl: APP_URL }).allow, `expected ${permission} to be denied`).toBe(false)
  }
})

// The reason is what main.ts logs; an empty one makes a future regression invisible.
test('every decision carries a non-empty reason for the log line', () => {
  const decisions = [
    req({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['audio'] }),
    req({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['video'] }),
    req({ permission: 'geolocation', requestingUrl: APP_URL }),
    req({ permission: 'media', requestingUrl: 'https://evil.example/' }),
    req({ permission: 'media', requestingUrl: APP_URL, isMainFrame: false }),
    chk({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'audio' }),
  ]
  for (const d of decisions) expect(d.reason.length).toBeGreaterThan(0)
})

// --- setPermissionCheckHandler --------------------------------------------------------
// Electron requires BOTH handlers: the request handler answers a prompt, the check handler
// answers a synchronous "do I already have this?" (navigator.permissions.query,
// enumerateDevices labels, and Chromium's own pre-flight before getUserMedia).

test('the check handler grants an audio media check from the bundle origin', () => {
  expect(chk({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'audio' }).allow).toBe(true)
})

// REGRESSION (review finding #1). Electron hands the check handler a GURL and gin serialises it
// via spec(), so the origin arrives WITH a trailing slash. Comparing it raw denied every check:
// Notification.permission read 'denied' (so meeting reminders fell back to alert()), device
// labels went blank, and Chromium's mic pre-flight could fail getUserMedia before the request
// handler was ever consulted — the exact failure this slice exists to prevent.
test('the check handler grants a trailing-slash origin — the form Electron actually passes', () => {
  for (const origin of ['http://localhost:5180/', 'http://127.0.0.1:5180/']) {
    expect(chk({ permission: 'media', requestingOrigin: origin, mediaType: 'audio' }).allow, `expected ${origin} to be granted`).toBe(true)
    expect(chk({ permission: 'notifications', requestingOrigin: origin }).allow, `expected notifications from ${origin} to be granted`).toBe(true)
  }
})

test('the request handler is unaffected by a trailing slash either way', () => {
  expect(req({ permission: 'media', requestingUrl: 'http://localhost:5180/', mediaTypes: ['audio'] }).allow).toBe(true)
  expect(req({ permission: 'media', requestingUrl: 'http://localhost:5180', mediaTypes: ['audio'] }).allow).toBe(true)
})

test('the check handler treats an unknown media type as the audio/screen-capture path', () => {
  expect(chk({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'unknown' }).allow).toBe(true)
  expect(chk({ permission: 'media', requestingOrigin: 'http://localhost:5180' }).allow).toBe(true)
})

test('the check handler denies a camera check', () => {
  expect(chk({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'video' }).allow).toBe(false)
})

test('the check handler denies any other origin, including an empty one', () => {
  expect(chk({ permission: 'media', requestingOrigin: 'https://accounts.google.com', mediaType: 'audio' }).allow).toBe(false)
  expect(chk({ permission: 'media', requestingOrigin: '', mediaType: 'audio' }).allow).toBe(false)
})

test('the check handler denies unlisted permissions from the bundle origin', () => {
  for (const permission of ['geolocation', 'clipboard-read', 'midiSysex', 'serial', 'usb']) {
    expect(chk({ permission, requestingOrigin: 'http://localhost:5180' }).allow, `expected ${permission} to be denied`).toBe(false)
  }
})

test('the check handler grants notifications from the bundle origin', () => {
  expect(chk({ permission: 'notifications', requestingOrigin: 'http://localhost:5180' }).allow).toBe(true)
})

// --- sub-frames and securityOrigin (review finding #2) --------------------------------
// CVE-2026-70599: Electron before 39.8.7 gives the check handler the TOP-LEVEL frame's origin
// rather than the requesting iframe's, so origin-based logic alone would see a cross-origin
// iframe as local. We pin electron ^33.2.0, which is affected. The app renders no iframes at
// all, so denying every sub-frame closes the class regardless of Electron version.

test('a sub-frame is denied on both handlers even from the bundle origin', () => {
  expect(req({ permission: 'media', requestingUrl: APP_URL, mediaTypes: ['audio'], isMainFrame: false }).allow).toBe(false)
  expect(req({ permission: 'notifications', requestingUrl: APP_URL, isMainFrame: false }).allow).toBe(false)
  expect(chk({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'audio', isMainFrame: false }).allow).toBe(false)
  expect(chk({ permission: 'notifications', requestingOrigin: 'http://localhost:5180', isMainFrame: false }).allow).toBe(false)
})

// The sub-frame check runs BEFORE the origin check, so a spoofed top-level origin cannot
// re-open the path — this is what makes the CVE moot rather than merely unlikely.
test('a sub-frame is denied before the origin is even considered', () => {
  const d = chk({ permission: 'media', requestingOrigin: 'http://localhost:5180', mediaType: 'audio', isMainFrame: false })
  expect(d.allow).toBe(false)
  expect(d.reason).toContain('sub-frame')
})

// securityOrigin is CHECK-PATH ONLY. Electron 33's request-details union does not carry it
// (tsc catches this; the specs could not), and the request path does not need it — requestingUrl
// is the requesting frame's own URL, so it is not iframe-confusable.
test('securityOrigin is preferred over the raw origin when Electron populates it', () => {
  // A foreign securityOrigin denies even when the fallback origin looks local.
  expect(chk({ permission: 'media', requestingOrigin: 'http://localhost:5180/', securityOrigin: 'https://evil.example', mediaType: 'audio' }).allow).toBe(false)
  // A local securityOrigin grants, in either serialisation.
  expect(chk({ permission: 'media', requestingOrigin: '', securityOrigin: 'http://localhost:5180/', mediaType: 'audio' }).allow).toBe(true)
  expect(chk({ permission: 'media', requestingOrigin: '', securityOrigin: 'http://localhost:5180', mediaType: 'audio' }).allow).toBe(true)
})

test('an empty or absent securityOrigin falls back to the origin rather than denying outright', () => {
  expect(chk({ permission: 'media', requestingOrigin: 'http://localhost:5180/', securityOrigin: '', mediaType: 'audio' }).allow).toBe(true)
  expect(chk({ permission: 'media', requestingOrigin: 'http://localhost:5180/', securityOrigin: undefined, mediaType: 'audio' }).allow).toBe(true)
})
