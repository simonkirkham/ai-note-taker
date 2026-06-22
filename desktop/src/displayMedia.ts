// 31-B — deterministic display-media grant.
// Selects the screen source to share when the renderer calls getDisplayMedia, and
// always pairs it with Windows loopback audio. Kept pure (no electron import) so the
// selection is unit-testable headlessly; main.ts supplies the live sources + primary id.

export type DisplayMediaGrant = {
  video: Electron.DesktopCapturerSource
  audio: 'loopback'
}

// Prefer the source whose display matches the primary monitor; fall back to the first
// available screen. Returns null when there is no screen at all — the caller then denies
// the request and the renderer falls back to mic-only (its existing catch path).
export function pickDisplayMediaResponse(
  sources: Electron.DesktopCapturerSource[],
  primaryDisplayId: string,
): DisplayMediaGrant | null {
  if (sources.length === 0) return null
  const primary = sources.find((s) => s.display_id === primaryDisplayId) ?? sources[0]
  return { video: primary, audio: 'loopback' }
}
