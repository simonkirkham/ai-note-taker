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
  // details.requestingUrl — the last URL the requesting frame loaded. Electron sets this from
  // render_frame_host->GetLastCommittedURL(), i.e. the REQUESTING frame, not the WebContents —
  // so unlike the check path it is not iframe-confusable and needs no securityOrigin. (Electron
  // 33's request-details union does not carry securityOrigin at all.)
  requestingUrl: string
  // The app renders no iframes at all, so a sub-frame asking for anything is never us.
  isMainFrame: boolean
  // Only present on a MediaAccessPermissionRequest. Absent for screen capture.
  mediaTypes?: ('audio' | 'video')[]
}

export type PermissionCheckQuery = {
  permission: string
  // NOT pre-normalised. Electron passes the GURL straight through and gin serialises it via
  // spec(), so this arrives as 'http://localhost:5180/' WITH a trailing slash — which is not
  // what `new URL(x).origin` produces and not what BUNDLE_ORIGINS holds. Always run it through
  // resolveOrigin; comparing the raw string denies every check and silently disables the mic
  // pre-flight, notifications and device labels.
  requestingOrigin: string
  securityOrigin?: string
  isMainFrame: boolean
  mediaType?: 'audio' | 'video' | 'unknown'
}

// Permissions the app genuinely uses. Anything else is denied even from the bundle origin.
//   media           — getUserMedia({ audio: true }), the transcription mic (this slice).
//   display-capture — getDisplayMedia for system audio; 31-B picks the source, this lets the
//                     request through in case Electron routes it via the permission handler.
//                     REQUEST-path only: Electron's check-handler permission union has no
//                     'display-capture', so listing it here never affects a check.
//   notifications   — Notification.requestPermission() for meeting reminders (already shipped;
//                     omitting it here would newly break it).
const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture', 'notifications'])

export function decidePermissionRequest(
  query: PermissionRequestQuery,
  allowedOrigins: readonly string[],
): PermissionDecision {
  return decide(
    query.permission,
    originOf(query.requestingUrl),
    wantsAudioCapture(query.mediaTypes),
    query.isMainFrame,
    allowedOrigins,
  )
}

export function decidePermissionCheck(
  query: PermissionCheckQuery,
  allowedOrigins: readonly string[],
): PermissionDecision {
  // 'unknown' is not "a camera" — it is Chromium not saying. Treat it like an unspecified
  // request handler call: audio-capable, so the mic and screen-capture paths still pass.
  // This is the one intentionally-open default in the module; every other path defaults closed.
  const audioCapable = query.mediaType !== 'video'
  return decide(
    query.permission,
    resolveOrigin(query.securityOrigin, query.requestingOrigin),
    audioCapable,
    query.isMainFrame,
    allowedOrigins,
  )
}

function decide(
  permission: string,
  origin: string,
  audioCapable: boolean,
  isMainFrame: boolean,
  allowedOrigins: readonly string[],
): PermissionDecision {
  // Sub-frames first, and deliberately before the origin check. The app renders no iframes at
  // all (no <iframe>, no embed, no dangerouslySetInnerHTML anywhere in web/src), so a sub-frame
  // asking for anything is never us. This also closes CVE-2026-70599 by construction: Electron
  // before 39.8.7 hands the check handler the TOP-LEVEL frame's origin rather than the
  // requesting iframe's, so origin-based logic alone would see a cross-origin iframe as local.
  // We pin electron ^33.2.0, which is affected — denying every sub-frame makes the version moot.
  if (!isMainFrame) {
    return { allow: false, reason: 'request came from a sub-frame; the app renders no iframes' }
  }
  // Origin next: this is the control that matters. The window leaves localhost for Google's
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

// Electron gives the origin two ways and neither is reliably normalised: securityOrigin when it
// populates it, otherwise a full URL (request path) or a GURL spec with a trailing slash (check
// path). Prefer securityOrigin — it is the advisory's own stated mitigation for CVE-2026-70599 —
// and put whichever we get through the same parser so 'http://localhost:5180/' and
// 'http://localhost:5180' both land on the value BUNDLE_ORIGINS actually holds.
function resolveOrigin(securityOrigin: string | undefined, fallbackUrl: string): string {
  return originOf(securityOrigin && securityOrigin.length > 0 ? securityOrigin : fallbackUrl)
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
