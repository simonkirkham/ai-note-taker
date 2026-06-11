import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import type { CalendarMeeting } from '../api/meetings'
import { keys } from '../api/queryKeys'
import {
  useCreateNoteFromMeeting,
  useCreateNoteFromNextOccurrence,
  useLinkNoteToCalendar,
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
  // A new meeting-note card's full shape isn't known client-side, so keys.noteCards
  // can't be patched optimistically — it's the sanctioned delayed-reconcile case
  // (27-C2): meetings invalidates immediately, the cards refetch is deferred past the
  // async projector's lag budget so it lands after the projection has caught up.
  it('create-from-meeting invalidates meetings immediately and defers noteCards', async () => {
    vi.useFakeTimers()
    try {
      server.use(http.post('/api/notes/from-meeting', () => HttpResponse.json({ noteId: 'n-1' }, { status: 201 })))
      const { qc, wrapper } = setup()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      const { result } = renderHook(() => useCreateNoteFromMeeting(), { wrapper })
      await act(async () => { await result.current.mutateAsync(meeting) })
      expect(spy).toHaveBeenCalledWith({ queryKey: ['meetings'] })
      expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.noteCards })
      await act(async () => { await vi.runOnlyPendingTimersAsync() })
      expect(spy).toHaveBeenCalledWith({ queryKey: keys.noteCards })
    } finally {
      vi.useRealTimers()
    }
  })

  it('create-from-next-occurrence invalidates meetings immediately and defers noteCards', async () => {
    vi.useFakeTimers()
    try {
      server.use(http.post('/api/notes/from-next-occurrence', () =>
        HttpResponse.json({ noteId: 'n-2', alreadyExists: true })))
      const { qc, wrapper } = setup()
      const spy = vi.spyOn(qc, 'invalidateQueries')
      const { result } = renderHook(() => useCreateNoteFromNextOccurrence(), { wrapper })
      await act(async () => { await result.current.mutateAsync('series1') })
      expect(spy).toHaveBeenCalledWith({ queryKey: ['meetings'] })
      expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.noteCards })
      await act(async () => { await vi.runOnlyPendingTimersAsync() })
      expect(spy).toHaveBeenCalledWith({ queryKey: keys.noteCards })
    } finally {
      vi.useRealTimers()
    }
  })

  it('link-to-calendar invalidates meetings', async () => {
    server.use(http.post('/api/notes/n-3/calendar-link', () => new HttpResponse(null, { status: 204 })))
    const { qc, wrapper } = setup()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useLinkNoteToCalendar(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ noteId: 'n-3', meeting }) })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['meetings'] })
  })
})
