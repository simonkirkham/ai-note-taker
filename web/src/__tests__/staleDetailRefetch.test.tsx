import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { clearStreamToken, setStreamToken } from '../api/consistencyTokens'
import type { NoteDetail } from '../api/notes'
import { keys } from '../api/queryKeys'
import { useNoteDetail } from '../hooks/useNoteDetail'
import { server } from '../test/setup'

// BUG-48: a background note-detail refetch (React Query `refetchOnMount`, fired on reopen) is
// RYW-gated. On a lagging projector the gate gives up after its bounded retries and returns a
// `X-Consistency: stale` body — which React Query then STORES, overwriting good cached detail.
// The note flashes blank (empty title/content) and the header flips Save→Cancel on `hasContent`.
// A stale read must never regress what is already cached.

const NOTE_ID = '11111111-1111-1111-1111-111111111111'

afterEach(() => clearStreamToken(`note#${NOTE_ID}`))

function Probe() {
  const { data } = useNoteDetail(NOTE_ID)
  return <div data-testid="title">{data?.title ?? ''}</div>
}

function renderProbe(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  )
}

function noteDetail(overrides: Partial<NoteDetail>): NoteDetail {
  return {
    noteId: NOTE_ID,
    title: '',
    content: '',
    date: null,
    tags: [],
    transcriptText: null,
    transcriptDraft: null,
    recordingAudioKey: null,
    transcriptIsDiarized: false,
    summary: null,
    discussionPoints: [],
    decisions: [],
    instructionResponses: [],
    summaryModelId: null,
    summaryPromptVersion: null,
    agenda: [],
    recurringSeriesId: null,
    isRecurring: false,
    linkedMeeting: null,
    ...overrides,
  }
}

describe('stale note-detail refetch (BUG-48)', () => {
  it('does not regress cached detail when the gated read gives up stale', async () => {
    const cached = noteDetail({ title: 'Kept title', content: 'kept body' })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(keys.note(NOTE_ID), cached)
    // A pending write token makes the read gated — the projector-lag case.
    setStreamToken(`note#${NOTE_ID}`, `note#${NOTE_ID}@9`)

    let gets = 0
    server.use(
      http.get(`/api/notes/${NOTE_ID}`, () => {
        gets++
        // The lagging projection: the note exists but its fold has not caught up.
        return HttpResponse.json(noteDetail({ title: '', content: '' }), {
          headers: { 'X-Consistency': 'stale' },
        })
      }),
    )

    const { getByTestId } = renderProbe(qc)

    // The gate makes its initial read plus its two bounded stale retries, then gives up. Only once
    // that has fully settled is the cache-overwrite the bug describes possible — asserting before
    // it does passes vacuously.
    await waitFor(() => expect(gets).toBe(3))
    await waitFor(() => expect(qc.getQueryState(keys.note(NOTE_ID))?.fetchStatus).toBe('idle'))

    expect(qc.getQueryData<NoteDetail>(keys.note(NOTE_ID))?.title).toBe('Kept title')
    expect(qc.getQueryData<NoteDetail>(keys.note(NOTE_ID))?.content).toBe('kept body')
    expect(getByTestId('title').textContent).toBe('Kept title')
  })

  it('accepts a fresh read that legitimately empties the note', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(keys.note(NOTE_ID), noteDetail({ title: 'Kept title', content: 'kept body' }))

    server.use(
      http.get(`/api/notes/${NOTE_ID}`, () =>
        HttpResponse.json(noteDetail({ title: '', content: '' }), {
          headers: { 'X-Consistency': 'fresh' },
        })),
    )

    renderProbe(qc)

    await waitFor(() => {
      expect(qc.getQueryData<NoteDetail>(keys.note(NOTE_ID))?.title).toBe('')
    })
  })

  it('uses a stale body when there is nothing cached to protect', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    setStreamToken(`note#${NOTE_ID}`, `note#${NOTE_ID}@9`)

    server.use(
      http.get(`/api/notes/${NOTE_ID}`, () =>
        HttpResponse.json(noteDetail({ title: 'From a lagging read' }), {
          headers: { 'X-Consistency': 'stale' },
        })),
    )

    const { getByTestId } = renderProbe(qc)

    await waitFor(() => expect(getByTestId('title').textContent).toBe('From a lagging read'))
  })
})
