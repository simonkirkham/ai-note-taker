import { ApiError } from '../api/client'
import { recordRumEvent } from '../rum'

// BUG-77: analysis used to report every failure as "Analysis failed. Please try again." — one
// sentence covering a dead network, an expired sign-in, a refused request and a server fault, so
// the sentence was often wrong about what broke and the advice sometimes impossible to act on.
// This turns a thrown error into (a) something true to say to the user and (b) the fields a second
// occurrence can be diagnosed from.

export type AnalyseFailureKind =
  | 'auth'
  | 'forbidden'
  | 'notFound'
  | 'rateLimited'
  | 'server'
  | 'network'
  | 'request'
  | 'unknown'

export interface AnalyseFailure {
  /** Shown to the user. Says what failed and what, if anything, will help. */
  message: string
  kind: AnalyseFailureKind
  /** The HTTP status, or null when the request never produced one (a network failure). */
  status: number | null
  /**
   * False only when the browser refused the request before dispatching it — nothing left the
   * machine, so no server-side log, metric or access record will ever mention it. True otherwise,
   * including a network failure, where the attempt was made and may have arrived.
   */
  sent: boolean
  /** The underlying error text, truncated. Diagnostic only — never shown to the user. */
  detail: string
}

const DETAIL_MAX = 200

function detailOf(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text
}

function fromStatus(status: number): { kind: AnalyseFailureKind; message: string } {
  if (status === 401) {
    return { kind: 'auth', message: 'Your sign-in has expired. Sign in again, then analyse this note.' }
  }
  if (status === 403) {
    return { kind: 'forbidden', message: 'You do not have access to analyse this note.' }
  }
  if (status === 404) {
    return { kind: 'notFound', message: 'This note no longer exists, so there is nothing to analyse.' }
  }
  if (status === 429) {
    return { kind: 'rateLimited', message: 'Too many requests just now. Wait a moment, then analyse again.' }
  }
  if (status >= 500) {
    return { kind: 'server', message: 'Analysis is temporarily unavailable. Try again in a minute.' }
  }
  return { kind: 'request', message: `Analysis was refused (error ${status}). Please try again.` }
}

export function describeAnalyseFailure(error: unknown): AnalyseFailure {
  const detail = detailOf(error)

  if (error instanceof ApiError) {
    const { kind, message } = fromStatus(error.status)
    return { message, kind, status: error.status, sent: !error.notSent, detail }
  }

  // `fetch` rejects with a TypeError when the request cannot be completed at all — offline, DNS
  // failure, a dropped connection, a blocked request. Same test the transient-retry loop uses.
  if (error instanceof TypeError) {
    return {
      message: 'Could not reach the server — check your connection, then analyse again.',
      kind: 'network',
      status: null,
      sent: true,
      detail,
    }
  }

  return {
    message: 'Analysis failed unexpectedly. Please try again.',
    kind: 'unknown',
    status: null,
    sent: true,
    detail,
  }
}

/**
 * Which of the three ways an analyse can be asked for failed. `auto` is the one that runs on its
 * own after a recording stops — the only one that can fail without the user having asked for
 * anything, and the one the first live occurrence came from.
 */
export type AnalyseTrigger = 'auto' | 'manual' | 'finalNotes'

/**
 * Describe the failure, record it, and hand the caller the sentence to show. Every analyse entry
 * point goes through here — a second one that reports its own way is how BUG-77 stayed invisible.
 */
export function reportAnalyseFailure(
  error: unknown,
  context: { noteId: string; trigger: AnalyseTrigger; startedAt: number },
): AnalyseFailure {
  const failure = describeAnalyseFailure(error)
  recordRumEvent('analyseFailed', {
    noteId: context.noteId,
    trigger: context.trigger,
    kind: failure.kind,
    status: failure.status,
    sent: failure.sent,
    // How long it took to fail separates an instant refusal from a request that ran and gave up —
    // the analyse path is slow (a calendar fetch precedes the model call), so a deadline
    // interacting with it is an untested candidate, not a diagnosis.
    elapsedMs: Date.now() - context.startedAt,
    online: navigator.onLine,
    detail: failure.detail,
  })
  console.error(`Analyse failed for note ${context.noteId} (${failure.kind})`, error)
  return failure
}
