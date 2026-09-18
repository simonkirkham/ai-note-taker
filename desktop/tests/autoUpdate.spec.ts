import { test, expect } from '@playwright/test'
import { EventEmitter } from 'node:events'
import { createAutoUpdate, CHECK_EVERY_MS, type AutoUpdateState, type Updater } from '../src/autoUpdate'

// 54-A — the main-process half of self-updating: drive the updater, and turn its events into the
// one state the notice reads. Each test names the phase-doc scenario it covers.

class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = false
  autoInstallOnAppQuit = false
  checks = 0
  installs: [boolean | undefined, boolean | undefined][] = []
  checkResult: Promise<unknown> = Promise.resolve(null)
  checkForUpdates() {
    this.checks++
    return this.checkResult
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.installs.push([isSilent, isForceRunAfter])
  }
}

function setup(opts: { isPackaged?: boolean } = {}) {
  const updater = new FakeUpdater()
  const states: AutoUpdateState[] = []
  const warnings: string[] = []
  const timers: { fn: () => void; ms: number }[] = []
  const auto = createAutoUpdate({
    updater,
    isPackaged: opts.isPackaged ?? true,
    onState: (s) => states.push(s),
    warn: (m) => warnings.push(m),
    setInterval: (fn, ms) => {
      timers.push({ fn, ms })
    },
  })
  return { updater, states, warnings, timers, auto }
}

test('downloads in the background and installs when the app closes', () => {
  const { updater, auto } = setup()
  auto.start()
  expect(updater.autoDownload).toBe(true)
  expect(updater.autoInstallOnAppQuit).toBe(true)
  expect(updater.checks).toBe(1)
})

test('Scenario: Update ready — a finished download is "ready"', () => {
  const { updater, states, auto } = setup()
  auto.start()
  updater.emit('checking-for-update')
  updater.emit('update-available', { version: '1.0.0-20260918.2' })
  updater.emit('download-progress', { percent: 40 })
  updater.emit('update-downloaded', { version: '1.0.0-20260918.2' })
  expect(states).toEqual(['checking', 'downloading', 'ready'])
  expect(auto.getState()).toBe('ready')
})

test('Scenario: Up to date — no newer version is "none"', () => {
  const { updater, auto } = setup()
  auto.start()
  updater.emit('checking-for-update')
  updater.emit('update-not-available', {})
  expect(auto.getState()).toBe('none')
})

test('Scenario: Automatic update fails — an updater error is "failed" and says why', () => {
  const { updater, warnings, auto } = setup()
  auto.start()
  updater.emit('checking-for-update')
  updater.emit('update-available', {})
  updater.emit('error', new Error('net::ERR_CONNECTION_RESET'))
  expect(auto.getState()).toBe('failed')
  expect(warnings.join('\n')).toContain('net::ERR_CONNECTION_RESET')
})

test('Scenario: Automatic update fails — a rejected check is "failed", never an unhandled rejection', async () => {
  const { updater, warnings, auto } = setup()
  updater.checkResult = Promise.reject(new Error('Cannot find latest.yml'))
  auto.start()
  await expect.poll(() => auto.getState()).toBe('failed')
  expect(warnings.join('\n')).toContain('Cannot find latest.yml')
})

test('checks again every hour', () => {
  const { updater, timers, auto } = setup()
  auto.start()
  expect(timers).toHaveLength(1)
  expect(timers[0].ms).toBe(CHECK_EVERY_MS)
  expect(CHECK_EVERY_MS).toBe(60 * 60 * 1000)
  updater.emit('update-not-available', {})
  timers[0].fn()
  expect(updater.checks).toBe(2)
})

test('an hourly check does not restart a download already under way', () => {
  const { updater, timers, auto } = setup()
  auto.start()
  updater.emit('update-available', {})
  timers[0].fn()
  expect(updater.checks).toBe(1)
})

test('stays "ready" once downloaded, whatever a later check reports', () => {
  const { updater, timers, auto } = setup()
  auto.start()
  updater.emit('update-downloaded', {})
  timers[0].fn()
  updater.emit('checking-for-update')
  updater.emit('update-not-available', {})
  updater.emit('error', new Error('offline'))
  expect(auto.getState()).toBe('ready')
})

test('an unpackaged (dev) build never checks and reports "disabled"', () => {
  const { updater, timers, auto } = setup({ isPackaged: false })
  auto.start()
  expect(updater.checks).toBe(0)
  expect(timers).toHaveLength(0)
  expect(auto.getState()).toBe('disabled')
})

test('Scenario: Restart now — installs silently and reopens the app', () => {
  const { updater, auto } = setup()
  auto.start()
  updater.emit('update-downloaded', {})
  auto.restart()
  expect(updater.installs).toEqual([[true, true]])
})

test('Restart does nothing until an update is ready', () => {
  const { updater, auto } = setup()
  auto.start()
  updater.emit('update-available', {})
  auto.restart()
  expect(updater.installs).toEqual([])
})

test('only announces a state when it changes', () => {
  const { updater, states, auto } = setup()
  auto.start()
  updater.emit('update-available', {})
  updater.emit('download-progress', { percent: 10 })
  updater.emit('update-available', {})
  expect(states).toEqual(['downloading'])
})
