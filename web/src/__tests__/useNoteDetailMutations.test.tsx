import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { NoteCard } from '../api/notes'
import { keys } from '../api/queryKeys'
import { useEditContent, useSetNoteDate } from '../hooks/useNoteDetailMutations'
import { server } from '../test/setup'

// 27-C2: content/date edits patch the matching home card (preview/date) optimistically
// instead of invalidating the lagging cards projection.

const card: NoteCard = {
  noteId: 'n-1', title: 'Sync', contentPreview: 'old preview', date: '2026-01-01',
  openActions: [], createdAt: '2026-01-01T00:00:00Z', lastModifiedAt: '2026-01-01T00:00:00Z',
  tags: [], folderId: null,
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData(keys.noteCards, [card])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const theCard = (qc: QueryClient) =>
  qc.getQueryData<NoteCard[]>(keys.noteCards)!.find((c) => c.noteId === 'n-1')!

describe('note-detail mutations patch the home card (27-C2)', () => {
  it('content edit updates the card preview without an invalidate', async () => {
    server.use(http.put('/api/notes/n-1/content', () => new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useEditContent('n-1'), { wrapper })

    await act(async () => { await result.current.mutateAsync('# Heading\n\nNew body text') })

    expect(theCard(qc).contentPreview).toBe('Heading\n\nNew body text')
    expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.noteCards })
  })

  it('date set updates the card date without an invalidate', async () => {
    server.use(http.patch('/api/notes/n-1/date', () => new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useSetNoteDate('n-1'), { wrapper })

    await act(async () => { await result.current.mutateAsync('2026-06-15') })

    expect(theCard(qc).date).toBe('2026-06-15')
    expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.noteCards })
  })
})
