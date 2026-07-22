import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { CalendarMeeting } from '../api/meetings'
import type { NoteDetail } from '../api/notes'
import { keys } from '../api/queryKeys'
import {
  useCreateNoteFromMeeting,
  useCreateNoteFromNextOccurrence,
  useLinkNoteToCalendar,
  useUnlinkNoteFromCalendar,
} from '../hooks/useMeetingMutations'
import { server } from '../test/setup'

const meeting: CalendarMeeting = {
  calendarEventId: 'evt1', title: 'Standup', startTime: '2026-05-20T09:00:00Z',
  endTime: '2026-05-20T09:30:00Z', isRecurring: true, recurringSeriesId: 'series1',
  linkedNoteId: null, hasNextOccurrenceNote: false, nextOccurrenceNoteId: null,
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

describe('useMeetingMutations', () => {
  it('create-from-meeting invalidates noteCards + meetings', async () => {
    server.use(http.post('/api/notes/from-meeting', () => HttpResponse.json({ noteId: 'n-1' }, { status: 201 })))
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateNoteFromMeeting(), { wrapper })
    await act(async () => { await result.current.mutateAsync(meeting) })
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.noteCards })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['meetings'] })
  })

  it('create-from-next-occurrence invalidates noteCards + meetings', async () => {
    server.use(http.post('/api/notes/from-next-occurrence', () =>
      HttpResponse.json({ noteId: 'n-2', alreadyExists: true })))
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateNoteFromNextOccurrence(), { wrapper })
    await act(async () => { await result.current.mutateAsync('series1') })
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.noteCards })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['meetings'] })
  })

  it('link-to-calendar invalidates meetings', async () => {
    server.use(http.post('/api/notes/n-3/calendar-link', () => new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useLinkNoteToCalendar(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ noteId: 'n-3', meeting }) })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['meetings'] })
  })

  function seedLinkedNote(qc: QueryClient, noteId: string) {
    const detail: Partial<NoteDetail> = {
      noteId, title: 'Prep', content: 'notes', tags: ['keep'],
      recurringSeriesId: 'series1', isRecurring: true,
      linkedMeeting: {
        calendarEventId: 'evt1', title: 'Standup', startTime: '2026-05-20T09:00:00Z',
        endTime: '2026-05-20T09:30:00Z', recurringSeriesId: 'series1', isRecurring: true,
      },
    }
    qc.setQueryData(keys.note(noteId), detail)
  }

  it('unlink-from-calendar invalidates meetings', async () => {
    server.use(http.delete('/api/notes/n-4/calendar-link', () => new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUnlinkNoteFromCalendar(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ noteId: 'n-4' }) })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['meetings'] })
  })

  it('unlink optimistically clears the linked meeting', async () => {
    server.use(http.delete('/api/notes/n-5/calendar-link', () => new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup()
    seedLinkedNote(qc, 'n-5')
    const { result } = renderHook(() => useUnlinkNoteFromCalendar(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ noteId: 'n-5' }) })
    const after = qc.getQueryData<NoteDetail>(keys.note('n-5'))
    expect(after?.linkedMeeting).toBeNull()
    expect(after?.recurringSeriesId).toBeNull()
    // The rest of the note is untouched.
    expect(after?.title).toBe('Prep')
    expect(after?.tags).toEqual(['keep'])
  })

  it('unlink rolls back the linked meeting on error', async () => {
    server.use(http.delete('/api/notes/n-6/calendar-link', () => new HttpResponse(null, { status: 500 })))
    const { qc, wrapper } = setup()
    seedLinkedNote(qc, 'n-6')
    const { result } = renderHook(() => useUnlinkNoteFromCalendar(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ noteId: 'n-6' }).catch(() => {})
    })
    const after = qc.getQueryData<NoteDetail>(keys.note('n-6'))
    expect(after?.linkedMeeting?.calendarEventId).toBe('evt1')
  })
})
