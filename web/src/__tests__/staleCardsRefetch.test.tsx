import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { setLatestToken } from '../api/consistencyTokens'
import { NOTE_CARDS_SCOPE, type NoteCard } from '../api/notes'
import { keys } from '../api/queryKeys'
import { useNoteCards } from '../hooks/useNoteCards'
import { server } from '../test/setup'

// TI-65 / BUG-44: the home list is a RYW-gated read. When the projector is behind, the gate gives
// up after its bounded retries and answers `X-Consistency: stale` — the projection BEFORE the write
// the user just made. React Query stored that body verbatim, so the note the user deleted came back
// and stayed openable, a just-created note vanished, and a just-moved note jumped back.
//
// The remedy is NOT BUG-48's "hold the cached body": a list is not one stream. The gate waits on the
// single most-recently-written note (design decision #7), so `stale` says the body is behind on THAT
// note and nothing else. Holding the whole cached list would pin another tab's deletion into view or
// hide its addition. So the stale body is taken as the new list, with only the gated note's row
// reconciled from cache.

const NOTE_A = '11111111-1111-1111-1111-111111111111'
const NOTE_B = '22222222-2222-2222-2222-222222222222'
const NOTE_C = '33333333-3333-3333-3333-333333333333'

function card(noteId: string, overrides: Partial<NoteCard> = {}): NoteCard {
  return {
    noteId,
    title: `Note ${noteId.slice(0, 1)}`,
    contentPreview: '',
    date: null,
    openActions: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    lastModifiedAt: '2026-08-01T00:00:00.000Z',
    tags: [],
    folderId: null,
    ...overrides,
  }
}

function Probe() {
  const { data } = useNoteCards()
  return <div data-testid="ids">{(data ?? []).map((c) => c.noteId).join(',')}</div>
}

function renderProbe(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  )
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function cardsRead(cards: NoteCard[], consistency: 'stale' | 'fresh') {
  return http.get('/api/notes/cards', () =>
    HttpResponse.json({ cards }, consistency === 'stale' ? { headers: { 'X-Consistency': 'stale' } } : undefined),
  )
}

function cachedIds(qc: QueryClient): string[] {
  return (qc.getQueryData<NoteCard[]>(keys.noteCards) ?? []).map((c) => c.noteId)
}

describe('stale note-cards refetch (TI-65)', () => {
  it('does not resurrect a note the user just deleted', async () => {
    const qc = newClient()
    // The optimistic delete already dropped B from the cache; the refetch is gated on the delete.
    qc.setQueryData(keys.noteCards, [card(NOTE_A)])
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_B}@7`)
    server.use(cardsRead([card(NOTE_A), card(NOTE_B)], 'stale'))

    const { getByTestId } = renderProbe(qc)

    await waitFor(() => expect(qc.getQueryState(keys.noteCards)?.fetchStatus).toBe('idle'))
    expect(cachedIds(qc)).toEqual([NOTE_A])
    expect(getByTestId('ids').textContent).toBe(NOTE_A)
  })

  it('still delivers a note added elsewhere while protecting the deleted one', async () => {
    const qc = newClient()
    qc.setQueryData(keys.noteCards, [card(NOTE_A)])
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_B}@7`)
    // C was created in another tab — the stale body is the only place it can come from, so
    // "hold the cached list" would hide it.
    server.use(cardsRead([card(NOTE_A), card(NOTE_B), card(NOTE_C)], 'stale'))

    renderProbe(qc)

    await waitFor(() => expect(cachedIds(qc)).toContain(NOTE_C))
    expect(cachedIds(qc)).not.toContain(NOTE_B)
  })

  it('keeps a note the user just created that the projection has not caught up to', async () => {
    const qc = newClient()
    qc.setQueryData(keys.noteCards, [card(NOTE_C), card(NOTE_A)])
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_C}@1`)
    server.use(cardsRead([card(NOTE_A)], 'stale'))

    renderProbe(qc)

    await waitFor(() => expect(qc.getQueryState(keys.noteCards)?.fetchStatus).toBe('idle'))
    expect(cachedIds(qc)).toContain(NOTE_C)
  })

  it("keeps the user's own move rather than the projection's old placement", async () => {
    const qc = newClient()
    qc.setQueryData(keys.noteCards, [card(NOTE_A, { folderId: 'folder-2' })])
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_A}@4`)
    server.use(cardsRead([card(NOTE_A, { folderId: null })], 'stale'))

    renderProbe(qc)

    await waitFor(() => expect(qc.getQueryState(keys.noteCards)?.fetchStatus).toBe('idle'))
    expect(qc.getQueryData<NoteCard[]>(keys.noteCards)?.[0].folderId).toBe('folder-2')
  })

  it('lets a stale body update every note the gate was NOT waiting on', async () => {
    // The property that separates this from BUG-48's whole-body hold: the gate only ever waited on
    // one stream, so every other row in the stale body is at least as good as what is cached.
    const qc = newClient()
    qc.setQueryData(keys.noteCards, [card(NOTE_A, { title: 'Stale local title' }), card(NOTE_B)])
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_B}@7`)
    server.use(cardsRead([card(NOTE_A, { title: 'Server title' }), card(NOTE_B)], 'stale'))

    renderProbe(qc)

    await waitFor(() =>
      expect(qc.getQueryData<NoteCard[]>(keys.noteCards)?.find((c) => c.noteId === NOTE_A)?.title).toBe(
        'Server title',
      ),
    )
  })

  it('takes a fresh read outright, deletions included', async () => {
    const qc = newClient()
    qc.setQueryData(keys.noteCards, [card(NOTE_A), card(NOTE_B)])
    server.use(cardsRead([card(NOTE_A)], 'fresh'))

    renderProbe(qc)

    await waitFor(() => expect(cachedIds(qc)).toEqual([NOTE_A]))
  })

  it('uses a stale body whole when there is nothing cached to protect', async () => {
    const qc = newClient()
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_B}@7`)
    server.use(cardsRead([card(NOTE_A), card(NOTE_B)], 'stale'))

    renderProbe(qc)

    await waitFor(() => expect(cachedIds(qc)).toEqual([NOTE_A, NOTE_B]))
  })

  it('stops protecting after repeated stale reads, so an unreachable token cannot pin a row', async () => {
    // ConsistencyGate documents a token that never becomes reachable (a lost write — BUG-27).
    // Protecting the row forever would hide that note's real state for the whole session.
    const qc = newClient()
    qc.setQueryData(keys.noteCards, [card(NOTE_A)])
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_B}@9999`)
    server.use(cardsRead([card(NOTE_A), card(NOTE_B)], 'stale'))

    renderProbe(qc)
    await waitFor(() => expect(cachedIds(qc)).toEqual([NOTE_A]))

    for (let i = 0; i < 4; i++) await qc.refetchQueries({ queryKey: keys.noteCards })

    expect(cachedIds(qc)).toEqual([NOTE_A, NOTE_B])
    // Every stale read pays gatedRead's two 300 ms retries, so a multi-refetch test needs more
    // than the 5 s default.
  }, 20000)

  it('re-arms the protection budget after the projection catches up', async () => {
    const qc = newClient()
    qc.setQueryData(keys.noteCards, [card(NOTE_A)])
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_B}@9999`)

    let mode: 'stale' | 'fresh' = 'stale'
    server.use(
      http.get('/api/notes/cards', () =>
        mode === 'fresh'
          ? HttpResponse.json({ cards: [card(NOTE_A)] })
          : HttpResponse.json({ cards: [card(NOTE_A), card(NOTE_B)] }, { headers: { 'X-Consistency': 'stale' } }),
      ),
    )

    renderProbe(qc)
    await waitFor(() => expect(cachedIds(qc)).toEqual([NOTE_A]))
    await qc.refetchQueries({ queryKey: keys.noteCards })

    mode = 'fresh'
    await qc.refetchQueries({ queryKey: keys.noteCards })
    expect(cachedIds(qc)).toEqual([NOTE_A])

    // Lagging again: with a re-armed budget the deleted row stays out for another MAX_HOLDS reads.
    mode = 'stale'
    setLatestToken(NOTE_CARDS_SCOPE, `note#${NOTE_B}@9999`)
    for (let i = 0; i < 3; i++) await qc.refetchQueries({ queryKey: keys.noteCards })
    expect(cachedIds(qc)).toEqual([NOTE_A])
  }, 20000)
})
