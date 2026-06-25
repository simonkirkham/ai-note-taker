import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { NoteDetail } from '../api/notes'
import { keys } from '../api/queryKeys'
import { useNoteDetail } from '../hooks/useNoteDetail'
import { useTagNote } from '../hooks/useTagMutations'
import { server } from '../test/setup'

function makeNote(tags: string[]): NoteDetail {
  return {
    noteId: 'n1', title: 'T', content: '', date: null, tags,
    transcriptText: null, transcriptDraft: null, recordingAudioKey: null, transcriptIsDiarized: false, summary: null,
    discussionPoints: [], decisions: [], instructionResponses: [], summaryModelId: null,
    summaryPromptVersion: null, recurringSeriesId: null, isRecurring: false,
    linkedMeeting: null,
  }
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

function useHarness() {
  const detail = useNoteDetail('n1')
  const tag = useTagNote()
  return { detail, tag }
}

// BUG-14: pasting space-separated tags ("1:1s Bill") fires two concurrent optimistic
// tag mutations. If the freshly-created note's initial keys.note GET is still in
// flight, onMutate's optimistic patch is a no-op (no cached note to patch), the GET
// then resolves tagless (it was issued before the tags existed), and nothing refetches
// keys.note — so the pill(s) never appear. Reproduced here; the fix makes onSettled
// reconcile keys.note to server truth.
describe('multi-tag optimistic add race (BUG-14)', () => {
  it('reflects both tags when added while the initial note-detail GET is in flight', async () => {
    const serverTags: string[] = []
    let openGate!: () => void
    const gate = new Promise<void>((resolve) => { openGate = resolve })
    let getCount = 0

    server.use(
      http.get('/api/notes/n1', async () => {
        getCount += 1
        if (getCount === 1) {
          const snapshot = [...serverTags] // tagless at issue time
          await gate
          return HttpResponse.json(makeNote(snapshot))
        }
        return HttpResponse.json(makeNote([...serverTags]))
      }),
      http.post('/api/notes/n1/tags', async ({ request }) => {
        const { tag } = (await request.json()) as { tag: string }
        serverTags.push(tag)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useHarness(), { wrapper })

    // Initial note-detail GET is in flight: no cached note yet.
    await waitFor(() => expect(result.current.detail.isPending).toBe(true))

    await act(async () => {
      // Two concurrent optimistic mutations (the space-separated paste path).
      result.current.tag.mutate({ noteId: 'n1', tag: 'a' })
      result.current.tag.mutate({ noteId: 'n1', tag: 'b' })
      // The initial GET resolves now — tagless, as issued before the tags.
      openGate()
    })

    await waitFor(() => expect(serverTags).toEqual(['a', 'b']))

    // The open note must end up reflecting both tags.
    await waitFor(() => {
      const tags = qc.getQueryData<NoteDetail>(keys.note('n1'))?.tags ?? []
      expect(tags).toEqual(expect.arrayContaining(['a', 'b']))
    })
  })
})

// CHANGE-17: useTagNote normalises centrally, so any caller (TagsSection, NoteView bulk
// paste) lands a lowercase optimistic pill AND sends a lowercase tag to the API.
describe('useTagNote case-insensitive normalisation (CHANGE-17)', () => {
  it('lowercases the optimistic pill and the API payload', async () => {
    let posted: string | undefined
    server.use(
      http.get('/api/notes/n1', () => HttpResponse.json(makeNote([]))),
      http.post('/api/notes/n1/tags', async ({ request }) => {
        posted = ((await request.json()) as { tag: string }).tag
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useHarness(), { wrapper })
    await waitFor(() => expect(qc.getQueryData<NoteDetail>(keys.note('n1'))).toBeDefined())

    await act(async () => {
      result.current.tag.mutate({ noteId: 'n1', tag: 'Foo Bar' })
    })

    // Optimistic pill is lowercase immediately.
    expect(qc.getQueryData<NoteDetail>(keys.note('n1'))?.tags).toContain('foo bar')
    // API receives the lowercase value.
    await waitFor(() => expect(posted).toBe('foo bar'))
  })
})
