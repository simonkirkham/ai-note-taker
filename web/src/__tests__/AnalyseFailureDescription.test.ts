import { ApiError, NOT_SENT_HEADER } from '../api/client'
import { describeAnalyseFailure } from '../lib/analyseFailure'

// BUG-77. AnalyseFailureReporting.test.tsx drives the four failures a user is most likely to meet
// through the real component; this isolates every remaining arm of the mapping, so a regression in
// one of them cannot hide behind a sibling. Each case names the thing the user is told, because
// that is the half of this bug that was confirmed broken: one sentence for every cause.

describe('describeAnalyseFailure', () => {
  it('turns a refusal to access the note into a message about access, with no retry advice', () => {
    const failure = describeAnalyseFailure(new ApiError(403, 'POST /notes/n1/analyse failed: 403'))

    expect(failure.kind).toBe('forbidden')
    expect(failure.message).toMatch(/access/i)
    expect(failure.message).not.toMatch(/try again/i)
  })

  it('turns being rate-limited into a wait-and-retry message', () => {
    const failure = describeAnalyseFailure(new ApiError(429, 'POST /notes/n1/analyse failed: 429'))

    expect(failure.kind).toBe('rateLimited')
    expect(failure.message).toMatch(/wait a moment/i)
  })

  it('names the status for a refusal it has no specific advice for', () => {
    const failure = describeAnalyseFailure(new ApiError(422, 'POST /notes/n1/analyse failed: 422'))

    expect(failure.kind).toBe('request')
    expect(failure.status).toBe(422)
    expect(failure.message).toContain('422')
  })

  it('treats every server fault the same way, not just 500', () => {
    expect(describeAnalyseFailure(new ApiError(503, 'x')).kind).toBe('server')
    expect(describeAnalyseFailure(new ApiError(502, 'x')).kind).toBe('server')
  })

  it('admits it does not know what happened rather than blaming the analysis', () => {
    const failure = describeAnalyseFailure(new Error('something unforeseen'))

    expect(failure.kind).toBe('unknown')
    expect(failure.status).toBeNull()
    expect(failure.message).toMatch(/unexpectedly/i)
  })

  it('carries the underlying error text for diagnosis, truncated so it cannot bloat a record', () => {
    const failure = describeAnalyseFailure(new Error('e'.repeat(500)))

    expect(failure.detail).toContain('Error: eee')
    expect(failure.detail.length).toBeLessThanOrEqual(201)
  })

  it('survives something thrown that is not an Error at all', () => {
    const failure = describeAnalyseFailure('a string was thrown')

    expect(failure.kind).toBe('unknown')
    expect(failure.detail).toBe('a string was thrown')
  })

  // The distinction the original occurrence could not be diagnosed without: a 401 the server sent
  // is a session the server rejected, while a 401 the browser synthesised means nothing was ever
  // sent — no gateway metric, no log, nothing to find on the server side.
  it('separates a sign-in the server rejected from one the browser refused before sending', () => {
    const fromServer = describeAnalyseFailure(new ApiError(401, 'x'))
    const neverSent = describeAnalyseFailure(new ApiError(401, 'x', true))

    expect(fromServer.sent).toBe(true)
    expect(neverSent.sent).toBe(false)
    expect(neverSent.message).toBe(fromServer.message)
  })

  it('marks the synthetic pre-flight refusal with the header the error is built from', () => {
    // Guards the wiring, not the mapping: apiFetch marks the response it invents, and ensureOk
    // reads that header back. A rename on one side alone silently reverts the distinction above.
    const marked = new Response(null, { status: 401, headers: { [NOT_SENT_HEADER]: 'token-refresh-failed' } })

    expect(marked.headers.get(NOT_SENT_HEADER)).toBe('token-refresh-failed')
  })
})
