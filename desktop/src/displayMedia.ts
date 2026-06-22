// 31-B — deterministic display-media grant.
// Selects the screen source to share when the renderer calls getDisplayMedia, and
// always pairs it with Windows loopback audio. Kept pure (no electron import) so the
// selection is unit-testable headlessly; main.ts supplies the live sources + primary id.

export type DisplayMediaGrant = {
  video: Electron.DesktopCapturerSource
  audio: 'loopback'
}

export type DisplayMediaSelection = {
  // Passed straight to the Electron callback — the 'loopback' literal lives only here.
  grant: DisplayMediaGrant
  // True when the primary monitor was found; false when we fell back to the first source.
  // main.ts logs this so the manual check can confirm the *primary* screen was chosen,
  // not just that *a* screen was granted (a display_id skew would silently pick the wrong one).
  matchedPrimary: boolean
}

// Prefer the source whose display matches the primary monitor; fall back to the first
// available screen. Returns null when there is no screen at all — the caller then denies
// the request and the renderer falls back to mic-only (its existing catch path).
export function pickDisplayMediaResponse(
  sources: Electron.DesktopCapturerSource[],
  primaryDisplayId: string,
): DisplayMediaSelection | null {
  if (sources.length === 0) return null
  const match = sources.find((s) => s.display_id === primaryDisplayId)
  return { grant: { video: match ?? sources[0], audio: 'loopback' }, matchedPrimary: match !== undefined }
}
