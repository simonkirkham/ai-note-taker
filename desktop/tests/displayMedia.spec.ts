import { test, expect } from '@playwright/test'
import { pickDisplayMediaResponse } from '../src/displayMedia'

// 31-B — the deterministic display-media grant. These unit-test the pure source-selection
// logic with no Electron and no real display, the same headless seam as server.spec.ts.
// A fake DesktopCapturerSource needs only id + display_id for the selection.
function fakeSource(id: string, displayId: string): Electron.DesktopCapturerSource {
  return { id, display_id: displayId, name: `Screen ${id}` } as unknown as Electron.DesktopCapturerSource
}

test('no screen sources → null (renderer then falls back to mic-only)', () => {
  expect(pickDisplayMediaResponse([], 'D1')).toBeNull()
})

test('picks the source matching the primary display id, audio is loopback', () => {
  const sources = [fakeSource('s-second', 'D2'), fakeSource('s-primary', 'D1')]
  const sel = pickDisplayMediaResponse(sources, 'D1')
  expect(sel).not.toBeNull()
  expect(sel!.grant.video.id).toBe('s-primary')
  expect(sel!.grant.audio).toBe('loopback')
  expect(sel!.matchedPrimary).toBe(true)
})

test('falls back to the first source when none matches the primary display id', () => {
  const sources = [fakeSource('s-a', 'DX'), fakeSource('s-b', 'DY')]
  const sel = pickDisplayMediaResponse(sources, 'D-none')
  expect(sel!.grant.video.id).toBe('s-a')
  expect(sel!.grant.audio).toBe('loopback')
  expect(sel!.matchedPrimary).toBe(false)
})

test('always grants loopback audio regardless of which screen is chosen', () => {
  const sel = pickDisplayMediaResponse([fakeSource('only', 'D1')], 'D1')
  expect(sel!.grant.audio).toBe('loopback')
  expect(sel!.grant.video.id).toBe('only')
})
