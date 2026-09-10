import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { clearToken, setOnRefresh, setOnUnauthorized, setToken } from '../auth/tokenStore'
import RecordControl from '../components/RecordControl'
import type { UseTranscriptionResult } from '../hooks/useTranscription'
import { server } from '../test/setup'

// BUG-77. A recording finishes, the analysis never happens, and the only thing the user is told is
// "Analysis failed. Please try again." — one sentence for a dead network, an expired sign-in, a
// refused request and a server fault alike, and nothing recorded anywhere. These specs pin the two
// halves of the fix: the sentence must be true about what failed, and every failure must leave a
// record a second occurrence can be diagnosed from.
//
// The trigger of the original occurrence is NOT diagnosed and nothing here asserts one.

const recordRumEvent = vi.fn()
vi.mock('../rum', () => ({
  recordRumEvent: (type: string, data: Record<string, unknown>) => recordRumEvent(type, data),
}))

function txn(overrides: Partial<UseTranscriptionResult> = {}): UseTranscriptionResult {
  return {
    status: 'idle',
    transcript: '',
    elapsedSeconds: 0,
    error: undefined,
    recordingUpload: 'idle',
    diarization: 'idle',
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    awaitCommit: async () => {},
    reset: vi.fn(),
    ...overrides,
  }
}

function jwt(secondsFromNow: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }))
  return `header.${payload}.signature`
}

// The note already has content, so "Analyse note" is enabled from idle without a recording.
async function analyseFromButton(): Promise<void> {
  render(<RecordControl noteId="note-1" noteHasContent transcription={txn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Analyse note' }))
}

function shownError(): string {
  return screen.getByTestId('transcription-analyse-error').textContent ?? ''
}

function analyseFailedEvent(): Record<string, unknown> {
  const call = recordRumEvent.mock.calls.find(([type]) => type === 'analyseFailed')
  if (!call) throw new Error(`no analyseFailed event; recorded: ${JSON.stringify(recordRumEvent.mock.calls)}`)
  return call[1] as Record<string, unknown>
}

beforeEach(() => {
  recordRumEvent.mockClear()
  clearToken()
  setOnRefresh(async () => null)
  setOnUnauthorized(() => {})
})

afterEach(() => {
  clearToken()
  setOnRefresh(async () => null)
  setOnUnauthorized(() => {})
})

describe('what the user is told when an analysis fails', () => {
  // Scenario: the sign-in has expired and cannot be renewed
  //   Given the stored sign-in has expired and the silent renewal fails
  //   When the user asks for the note to be analysed
  //   Then they are told to sign in again, not that the analysis failed
  it('tells the user to sign in again when the sign-in has expired', async () => {
    setToken(jwt(-60))
    setOnRefresh(async () => null)

    await analyseFromButton()

    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()
    expect(shownError()).toMatch(/sign in again/i)
    expect(shownError()).not.toMatch(/analysis failed/i)
  })

  // Scenario: the server refuses the request as unauthenticated
  //   Given the server rejects the analyse request as unauthenticated
  //   When the user asks for the note to be analysed
  //   Then they are told to sign in again
  it('tells the user to sign in again when the server rejects the request as unauthenticated', async () => {
    server.use(http.post('/api/notes/note-1/analyse', () => new HttpResponse(null, { status: 401 })))

    await analyseFromButton()

    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()
    expect(shownError()).toMatch(/sign in again/i)
  })

  // Scenario: the network is unreachable
  //   Given the request cannot leave the machine
  //   When the user asks for the note to be analysed
  //   Then the message names the connection, not the analysis
  it('names the connection when the request cannot reach the server', async () => {
    server.use(http.post('/api/notes/note-1/analyse', () => HttpResponse.error()))

    await analyseFromButton()

    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()
    expect(shownError()).toMatch(/connection|reach/i)
  })

  // Scenario: the server itself fails
  //   Given the server returns a fault
  //   When the user asks for the note to be analysed
  //   Then they are told analysis is temporarily unavailable and to try shortly
  it('says analysis is temporarily unavailable when the server faults', async () => {
    server.use(http.post('/api/notes/note-1/analyse', () => new HttpResponse(null, { status: 500 })))

    await analyseFromButton()

    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()
    expect(shownError()).toMatch(/temporarily unavailable/i)
  })

  // Scenario: the note is gone
  //   Given the note no longer exists
  //   When the user asks for it to be analysed
  //   Then they are told the note is gone, and not told to try again
  it('says the note no longer exists rather than advising a retry that cannot work', async () => {
    server.use(http.post('/api/notes/note-1/analyse', () => new HttpResponse(null, { status: 404 })))

    await analyseFromButton()

    expect(await screen.findByTestId('transcription-analyse-error')).toBeInTheDocument()
    expect(shownError()).toMatch(/no longer exists/i)
    expect(shownError()).not.toMatch(/try again/i)
  })
})

describe('what is recorded when an analysis fails', () => {
  // Scenario: a server fault is recorded
  //   Given the server returns a fault
  //   When the user asks for the note to be analysed
  //   Then the failure is recorded with the note, the status, the kind, and that the request was sent
  it('records the note, the status, the kind and that the request was sent', async () => {
    server.use(http.post('/api/notes/note-1/analyse', () => new HttpResponse(null, { status: 500 })))

    await analyseFromButton()
    await screen.findByTestId('transcription-analyse-error')

    expect(analyseFailedEvent()).toEqual(
      expect.objectContaining({
        noteId: 'note-1',
        status: 500,
        kind: 'server',
        sent: true,
        trigger: 'manual',
        elapsedMs: expect.any(Number),
      }),
    )
  })

  // Scenario: a request that never left the browser
  //   Given the sign-in has expired and the silent renewal fails, so nothing is sent
  //   When the user asks for the note to be analysed
  //   Then the record says the request never left the browser
  //   And the server never sees a request
  it('records that the request never left the browser when the sign-in is refused before sending', async () => {
    setToken(jwt(-60))
    setOnRefresh(async () => null)
    let reached = 0
    server.use(
      http.post('/api/notes/note-1/analyse', () => {
        reached++
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await analyseFromButton()
    await screen.findByTestId('transcription-analyse-error')

    expect(reached).toBe(0)
    expect(analyseFailedEvent()).toEqual(
      expect.objectContaining({ status: 401, kind: 'auth', sent: false }),
    )
  })

  // Scenario: the automatic analysis after a recording
  //   Given a recording has just stopped with a transcript and auto-analyse is on
  //   When the automatic analysis fails
  //   Then the record says it was the automatic one, not a button press
  it('distinguishes the automatic analysis after a recording from a button press', async () => {
    server.use(http.post('/api/notes/note-1/analyse', () => new HttpResponse(null, { status: 500 })))

    const view = render(<RecordControl noteId="note-1" transcription={txn({ status: 'idle' })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    view.rerender(
      <RecordControl
        noteId="note-1"
        transcription={txn({ status: 'stopped', transcript: 'spoken words', diarization: 'idle' })}
      />,
    )

    await screen.findByTestId('transcription-analyse-error')
    expect(analyseFailedEvent()).toEqual(expect.objectContaining({ trigger: 'auto', status: 500 }))
  })

  // Scenario: a network failure is recorded as one
  //   Given the request cannot leave the machine
  //   When the user asks for the note to be analysed
  //   Then the record names a network failure with no status
  it('records a network failure with no status rather than a made-up one', async () => {
    server.use(http.post('/api/notes/note-1/analyse', () => HttpResponse.error()))

    await analyseFromButton()
    await screen.findByTestId('transcription-analyse-error')

    expect(analyseFailedEvent()).toEqual(
      expect.objectContaining({ kind: 'network', status: null, sent: true }),
    )
  })
})
