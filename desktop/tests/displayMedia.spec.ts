import { test, expect } from '@playwright/test'
import { pickDisplayMediaResponse } from '../src/displayMedia'

// 31-B — the deterministic display-media grant. These unit-test the pure source-selection
// logic with no Electron and no real display, the same headless seam as server.spec.ts.
// A fake DesktopCapturerSource needs only id + display_id for the selection.
function screen(id: string, displayId: string): Electron.DesktopCapturerSource {
  return { id, display_id: displayId, name: `Screen ${id}` } as unknown as Electron.DesktopCapturerSource
}

test('no screen sources → null (renderer then falls back to mic-only)', () => {
  expect(pickDisplayMediaResponse([], 'D1')).toBeNull()
})

test('picks the source matching the primary display id, audio is loopback', () => {
  const sources = [screen('s-second', 'D2'), screen('s-primary', 'D1')]
  const resp = pickDisplayMediaResponse(sources, 'D1')
  expect(resp).not.toBeNull()
  expect(resp!.video.id).toBe('s-primary')
  expect(resp!.audio).toBe('loopback')
})

test('falls back to the first source when none matches the primary display id', () => {
  const sources = [screen('s-a', 'DX'), screen('s-b', 'DY')]
  const resp = pickDisplayMediaResponse(sources, 'D-none')
  expect(resp!.video.id).toBe('s-a')
  expect(resp!.audio).toBe('loopback')
})

test('always grants loopback audio regardless of which screen is chosen', () => {
  const resp = pickDisplayMediaResponse([screen('only', 'D1')], 'D1')
  expect(resp!.audio).toBe('loopback')
  expect(resp!.video.id).toBe('only')
})
