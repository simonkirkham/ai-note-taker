// CHANGE-32 — pin the microphone grant. Without a permission handler, getUserMedia relies on
// Electron's implicit default (grants today, but undocumented) — an Electron upgrade that
// flipped it to deny would silently kill the whole recording flow, because the mic stream is
// the BASE transcription stream with no fallback (web/src/hooks/useTranscription.ts).
// Kept pure (no electron import) so the decision is unit-testable headlessly; main.ts wires
// it to session.defaultSession and does the logging.
//
// Posture: an ALLOW-LIST, not a blanket grant. Only the localhost bundle origin gets anything,
// and only the three permissions the app actually uses. A blanket callback(true) would be a
// regression on today's default, not a pin.

export type PermissionDecision = {
  allow: boolean
  // Logged by main.ts so a future regression (or an unexpected denial) is visible, not silent.
  reason: string
}

// Electron's request- and check-handler permission unions differ, so this takes a plain string
// and treats anything outside the allow-list below as denied.
export type PermissionRequestQuery = {
  permission: string
  // details.requestingUrl — the last URL the requesting frame loaded.
  requestingUrl: string
  // Only present on a MediaAccessPermissionRequest. Absent for screen capture.
  mediaTypes?: ('audio' | 'video')[]
}

export type PermissionCheckQuery = {
  permission: string
  // Already an origin, not a URL — Electron hands the check handler requestingOrigin directly.
  requestingOrigin: string
  mediaType?: 'audio' | 'video' | 'unknown'
}

// Permissions the app genuinely uses. Anything else is denied even from the bundle origin.
//   media           — getUserMedia({ audio: true }), the transcription mic (this slice).
//   display-capture — getDisplayMedia for system audio; 31-B picks the source, this lets the
//                     request through in case Electron routes it via the permission handler.
//   notifications   — Notification.requestPermission() for meeting reminders (already shipped;
//                     omitting it here would newly break it).
const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture', 'notifications'])

export function decidePermissionRequest(
  query: PermissionRequestQuery,
  allowedOrigins: readonly string[],
): PermissionDecision {
  return decide(query.permission, originOf(query.requestingUrl), wantsAudioCapture(query.mediaTypes), allowedOrigins)
}

export function decidePermissionCheck(
  query: PermissionCheckQuery,
  allowedOrigins: readonly string[],
): PermissionDecision {
  // 'unknown' is not "a camera" — it is Chromium not saying. Treat it like an unspecified
  // request handler call: audio-capable, so the mic and screen-capture paths still pass.
  const audioCapable = query.mediaType !== 'video'
  return decide(query.permission, query.requestingOrigin, audioCapable, allowedOrigins)
}

function decide(
  permission: string,
  origin: string,
  audioCapable: boolean,
  allowedOrigins: readonly string[],
): PermissionDecision {
  // Origin first: this is the control that matters. The window leaves localhost for Google's
  // sign-in during OAuth, and nothing off the bundle origin should be able to open the mic.
  if (!origin || !allowedOrigins.includes(origin)) {
    return { allow: false, reason: `origin ${origin || '(unknown)'} is not the bundle origin` }
  }
  if (!ALLOWED_PERMISSIONS.has(permission)) {
    return { allow: false, reason: `${permission} is not a permission this app uses` }
  }
  // The app has no camera feature, so a video-only media request is never one it made.
  if (permission === 'media' && !audioCapable) {
    return { allow: false, reason: 'camera-only media request; the app never uses the camera' }
  }
  return { allow: true, reason: `${permission} granted to the bundle origin` }
}

// Absent or empty mediaTypes means Electron did not populate device types — the screen-capture
// path. Denying that would break 31-B's system audio, so treat it as audio-capable.
function wantsAudioCapture(mediaTypes: ('audio' | 'video')[] | undefined): boolean {
  if (!mediaTypes || mediaTypes.length === 0) return true
  return mediaTypes.includes('audio')
}

// Returns '' for a malformed or empty URL, which decide() then denies — never falls back to
// treating an unparseable request as local.
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}
