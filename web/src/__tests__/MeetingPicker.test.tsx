import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import MeetingPicker from '../components/MeetingPicker'
import { server } from '../test/setup'

const noop = () => {}

function meeting(over: Record<string, unknown> = {}) {
  return {
    calendarEventId: 'evt_1', title: 'Sync',
    startTime: '2026-05-14T09:00:00Z', endTime: '2026-05-14T09:30:00Z',
    isRecurring: false, recurringSeriesId: null,
    linkedNoteId: null, hasNextOccurrenceNote: false, nextOccurrenceNoteId: null,
    ...over,
  }
}

describe('MeetingPicker', () => {
  it("lists the day's meetings", async () => {
    server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [meeting()] })))
    render(<MeetingPicker onSelect={noop} onClose={noop} linkingEventId={null} />)
    expect(await screen.findByTestId('picker-link-evt_1')).toBeInTheDocument()
  })

  it('calls onSelect with the chosen meeting', async () => {
    server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [meeting()] })))
    const onSelect = vi.fn()
    render(<MeetingPicker onSelect={onSelect} onClose={noop} linkingEventId={null} />)
    await userEvent.click(await screen.findByTestId('picker-link-evt_1'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ calendarEventId: 'evt_1' }))
  })

  it('shows a meeting already linked to another note as not selectable', async () => {
    server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [meeting({ linkedNoteId: 'other-note' })] })))
    render(<MeetingPicker onSelect={noop} onClose={noop} linkingEventId={null} />)
    expect(await screen.findByTestId('picker-linked-evt_1')).toBeInTheDocument()
    expect(screen.queryByTestId('picker-link-evt_1')).toBeNull()
  })

  it('shows an unavailable state when the calendar fetch fails', async () => {
    server.use(http.get('/api/calendar/:date', () => new HttpResponse(null, { status: 500 })))
    render(<MeetingPicker onSelect={noop} onClose={noop} linkingEventId={null} />)
    expect(await screen.findByTestId('picker-unavailable')).toBeInTheDocument()
  })

  it('navigating to the next day fetches that day', async () => {
    const days: string[] = []
    server.use(http.get('/api/calendar/:date', ({ params }) => {
      days.push(params.date as string)
      return HttpResponse.json({ meetings: [] })
    }))
    render(<MeetingPicker onSelect={noop} onClose={noop} linkingEventId={null} />)
    await screen.findByTestId('picker-empty')
    const firstDay = days[0]
    await userEvent.click(screen.getByTestId('picker-next-day'))
    await waitFor(() => expect(days.length).toBeGreaterThan(1))
    expect(days[days.length - 1]).not.toBe(firstDay)
  })

  it('closes on Escape', async () => {
    server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [] })))
    const onClose = vi.fn()
    render(<MeetingPicker onSelect={noop} onClose={onClose} linkingEventId={null} />)
    await screen.findByTestId('picker-empty')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
