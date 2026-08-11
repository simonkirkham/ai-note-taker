import { ApiError } from '../api/client'
import { describeAnalyseFailure, reportAnalyseFailure } from '../lib/analyseFailure'

const recordRumEvent = vi.fn()
vi.mock('../rum', () => ({
  recordRumEvent: (type: string, data: Record<string, unknown>) => recordRumEvent(type, data),
}))

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

})

describe('reportAnalyseFailure', () => {
  beforeEach(() => recordRumEvent.mockClear())

  // Every way of asking for an analysis reports through here, so the record is the same shape
  // whichever one failed — the "generate final notes" button included, which reported its own way
  // and recorded nothing until BUG-77.
  it('records the failure and hands back the sentence to show, whichever entry point failed', () => {
    const failure = reportAnalyseFailure(new ApiError(500, 'x'), {
      noteId: 'note-9',
      trigger: 'finalNotes',
      startedAt: Date.now() - 1200,
    })

    expect(failure.message).toMatch(/temporarily unavailable/i)
    expect(recordRumEvent).toHaveBeenCalledWith(
      'analyseFailed',
      expect.objectContaining({
        noteId: 'note-9',
        trigger: 'finalNotes',
        kind: 'server',
        status: 500,
        sent: true,
        online: true,
      }),
    )
    expect(recordRumEvent.mock.calls[0][1].elapsedMs).toBeGreaterThanOrEqual(1200)
  })
})
