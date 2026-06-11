import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { NoteCard } from '../api/notes'
import { keys } from '../api/queryKeys'
import { useDeleteFolder } from '../hooks/useFolderMutations'
import {
  useCreateNote,
  useRenameNote,
  useDeleteNote,
  useMoveNoteToFolder,
  useMoveNoteToWorkspace,
} from '../hooks/useNoteMutations'
import { server } from '../test/setup'

const card: NoteCard = {
  noteId: 'n-1', title: 'Sync', contentPreview: '', date: '2026-01-01',
  openActions: [], createdAt: '2026-01-01T00:00:00Z', lastModifiedAt: '2026-01-01T00:00:00Z',
  tags: [], folderId: null,
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

const cards = (qc: QueryClient) => qc.getQueryData<NoteCard[]>(keys.noteCards)!

describe('useNoteMutations', () => {
  it('create inserts the real server id into the cache', async () => {
    server.use(http.post('/api/notes', () => HttpResponse.json({ noteId: 'real-1' }, { status: 201 })))
    const { qc, wrapper } = setup([])
    const { result } = renderHook(() => useCreateNote(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ folderId: null }) })
    const list = cards(qc)
    expect(list).toHaveLength(1)
    expect(list[0].noteId).toBe('real-1')
  })

  it('rename is optimistic and rolls back on failure', async () => {
    let reject!: () => void
    server.use(http.patch('/api/notes/n-1/title', () =>
      new Promise<Response>((res) => { reject = () => res(new HttpResponse(null, { status: 500 }) as unknown as Response) })))
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useRenameNote(), { wrapper })
    act(() => { result.current.mutate({ noteId: 'n-1', title: 'Renamed' }) })
    await waitFor(() => expect(cards(qc)[0].title).toBe('Renamed'))
    await act(async () => { reject() })
    await waitFor(() => expect(cards(qc)[0].title).toBe('Sync'))
  })

  it('delete is optimistic and rolls back on failure', async () => {
    let reject!: () => void
    server.use(http.delete('/api/notes/n-1', () =>
      new Promise<Response>((res) => { reject = () => res(new HttpResponse(null, { status: 500 }) as unknown as Response) })))
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useDeleteNote(), { wrapper })
    act(() => { result.current.mutate('n-1') })
    await waitFor(() => expect(cards(qc)).toHaveLength(0))
    await act(async () => { reject() })
    await waitFor(() => expect(cards(qc).map((c) => c.noteId)).toEqual(['n-1']))
  })

  it('move-to-folder is optimistic and rolls back on failure', async () => {
    let reject!: () => void
    server.use(http.put('/api/notes/n-1/folder', () =>
      new Promise<Response>((res) => { reject = () => res(new HttpResponse(null, { status: 500 }) as unknown as Response) })))
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useMoveNoteToFolder(), { wrapper })
    act(() => { result.current.mutate({ noteId: 'n-1', folderId: 'f-1' }) })
    await waitFor(() => expect(cards(qc)[0].folderId).toBe('f-1'))
    await act(async () => { reject() })
    await waitFor(() => expect(cards(qc)[0].folderId).toBeNull())
  })

  it('move-to-workspace optimistically removes the card and rolls back on failure (23-F)', async () => {
    let reject!: () => void
    server.use(http.put('/api/notes/n-1/workspace', () =>
      new Promise<Response>((res) => { reject = () => res(new HttpResponse(null, { status: 500 }) as unknown as Response) })))
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useMoveNoteToWorkspace(), { wrapper })
    act(() => { result.current.mutate({ noteId: 'n-1', workspaceId: 'ws-2' }) })
    await waitFor(() => expect(cards(qc)).toHaveLength(0))
    await act(async () => { reject() })
    await waitFor(() => expect(cards(qc).map((c) => c.noteId)).toEqual(['n-1']))
  })

  it('deleting a folder defers the note-cards refetch past the projector lag (orphan refresh — 20-B/27-C2)', async () => {
    vi.useFakeTimers()
    try {
      server.use(http.delete('/api/folders/f-1', () => new HttpResponse(null, { status: 204 })))
      const { qc, wrapper } = setup()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      const { result } = renderHook(() => useDeleteFolder(), { wrapper })
      await act(async () => { await result.current.mutateAsync({ folderId: 'f-1' }) })
      // Orphaned-note card shapes aren't known client-side, so the refetch is deferred
      // (not immediate) so it lands after the async projector catches up.
      expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.noteCards })
      await act(async () => { await vi.runOnlyPendingTimersAsync() })
      expect(spy).toHaveBeenCalledWith({ queryKey: keys.noteCards })
    } finally {
      vi.useRealTimers()
    }
  })
})
