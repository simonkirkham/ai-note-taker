import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { NoteCard } from '../api/notes'
import { keys } from '../api/queryKeys'
import { useTagNote, useUntagNote } from '../hooks/useTagMutations'
import { server } from '../test/setup'

// 27-C2: tag/untag must keep the home card's tags correct via an optimistic patch of
// keys.noteCards (not a racing invalidate of the lagging cards projection).

const card: NoteCard = {
  noteId: 'n-1', title: 'Sync', contentPreview: '', date: '2026-01-01',
  openActions: [], createdAt: '2026-01-01T00:00:00Z', lastModifiedAt: '2026-01-01T00:00:00Z',
  tags: ['existing'], folderId: null,
}

function setup(seed: NoteCard[] = [card]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData(keys.noteCards, seed)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const cardTags = (qc: QueryClient) => {
  const found = qc.getQueryData<NoteCard[]>(keys.noteCards)?.find((c) => c.noteId === 'n-1')
  if (!found) throw new Error('card n-1 not in cache')
  return found.tags
}

describe('tag mutations patch the home card optimistically (27-C2)', () => {
  it('tag adds the tag to the matching card without an invalidate', async () => {
    const invalidates: unknown[] = []
    server.use(http.post('/api/notes/n-1/tags', () => new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockImplementation((arg) => {
      invalidates.push(arg)
      return Promise.resolve()
    })
    const { result } = renderHook(() => useTagNote(), { wrapper })

    act(() => { result.current.mutate({ noteId: 'n-1', tag: 'urgent' }) })

    await waitFor(() => expect(cardTags(qc)).toEqual(['existing', 'urgent']))
    expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.noteCards })
  })

  it('untag removes the tag from the matching card and rolls back on failure', async () => {
    let reject!: () => void
    server.use(http.delete('/api/notes/n-1/tags/existing', () =>
      new Promise<Response>((res) => {
        reject = () => res(new HttpResponse(null, { status: 500 }) as unknown as Response)
      })))
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useUntagNote(), { wrapper })

    act(() => { result.current.mutate({ noteId: 'n-1', tag: 'existing' }) })
    await waitFor(() => expect(cardTags(qc)).toEqual([]))

    await act(async () => { reject() })
    await waitFor(() => expect(cardTags(qc)).toEqual(['existing']))
  })
})
