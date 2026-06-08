import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { FolderNode } from '../api/folders'
import { keys } from '../api/queryKeys'
import { findNode } from '../folderTree'
import { useMoveFolder } from '../hooks/useFolderMutations'
import { server } from '../test/setup'

// Folder move is drag-drop in the UI (fragile in jsdom); the optimistic
// cache transform is tested directly against the query cache here.
const seed: FolderNode[] = [
  { folderId: 'f-1', name: 'People', children: [] },
  { folderId: 'f-2', name: 'Projects', children: [] },
]

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData(keys.folders, seed)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

const ids = (tree: FolderNode[]) => tree.map((n) => n.folderId)

describe('useMoveFolder', () => {
  it('reparents optimistically and rolls back on failure', async () => {
    let rejectMove!: () => void
    server.use(
      http.put('/api/folders/f-1/parent', () =>
        new Promise<Response>((res) => {
          rejectMove = () => res(new HttpResponse(null, { status: 500 }) as unknown as Response)
        }),
      ),
    )
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useMoveFolder(), { wrapper })

    act(() => { result.current.mutate({ folderId: 'f-1', parentFolderId: 'f-2' }) })

    // Optimistic: f-1 leaves the root and nests under f-2
    await waitFor(() => {
      const tree = qc.getQueryData<FolderNode[]>(keys.folders)!
      expect(ids(tree)).toEqual(['f-2'])
      expect(ids(findNode(tree, 'f-2')!.children)).toEqual(['f-1'])
    })

    // Fail → rollback restores the original flat tree
    await act(async () => { rejectMove() })
    await waitFor(() => {
      expect(ids(qc.getQueryData<FolderNode[]>(keys.folders)!)).toEqual(['f-1', 'f-2'])
    })
  })

  it('does not orphan the node on a self-drop (no-op optimistic transform)', async () => {
    server.use(http.put('/api/folders/f-1/parent', () => new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useMoveFolder(), { wrapper })
    act(() => { result.current.mutate({ folderId: 'f-1', parentFolderId: 'f-1' }) })
    // Tree is unchanged — f-1 is not removed-then-lost
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(ids(qc.getQueryData<FolderNode[]>(keys.folders)!)).toEqual(['f-1', 'f-2'])
  })
})
