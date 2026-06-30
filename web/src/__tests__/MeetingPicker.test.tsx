import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import MeetingPicker from '../components/MeetingPicker'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

const noop = () => {}

// Mounts a trigger button that opens the picker, so focus-restore-on-close
// can be asserted against the real triggering control.
function PickerHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open picker</button>
      {open && (
        <MeetingPicker onSelect={noop} onClose={() => setOpen(false)} linkingEventId={null} />
      )}
    </>
  )
}

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

  it('opens on initialDate when provided (Phase 44 — change meeting)', async () => {
    let requestedDate: string | null = null
    server.use(http.get('/api/calendar/:date', ({ params }) => {
      requestedDate = params.date as string
      return HttpResponse.json({ meetings: [meeting()] })
    }))
    render(<MeetingPicker onSelect={noop} onClose={noop} linkingEventId={null} initialDate="2026-05-14" />)
    await screen.findByTestId('picker-link-evt_1')
    expect(requestedDate).toBe('2026-05-14')
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

  describe('focus trap', () => {
    it('moves focus into the dialog on open', async () => {
      server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [] })))
      render(<MeetingPicker onSelect={noop} onClose={noop} linkingEventId={null} />)
      await screen.findByTestId('picker-empty')
      const dialog = screen.getByTestId('meeting-picker')
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    it('Tab from the last focusable element wraps to the first', async () => {
      server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [] })))
      render(<MeetingPicker onSelect={noop} onClose={noop} linkingEventId={null} />)
      await screen.findByTestId('picker-empty')

      const dialog = screen.getByTestId('meeting-picker')
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]')
      )
      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      last.focus()
      expect(document.activeElement).toBe(last)
      await userEvent.tab()
      expect(document.activeElement).toBe(first)
    })

    it('Shift+Tab from the first focusable element wraps to the last', async () => {
      server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [] })))
      render(<MeetingPicker onSelect={noop} onClose={noop} linkingEventId={null} />)
      await screen.findByTestId('picker-empty')

      const dialog = screen.getByTestId('meeting-picker')
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]')
      )
      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      first.focus()
      expect(document.activeElement).toBe(first)
      await userEvent.tab({ shift: true })
      expect(document.activeElement).toBe(last)
    })

    it('returns focus to the triggering control on close', async () => {
      server.use(http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [] })))
      render(<PickerHarness />)

      const trigger = screen.getByRole('button', { name: 'Open picker' })
      await userEvent.click(trigger)
      await screen.findByTestId('picker-empty')
      expect(document.activeElement).not.toBe(trigger)

      await userEvent.click(screen.getByTestId('meeting-picker-close'))
      await waitFor(() => expect(document.activeElement).toBe(trigger))
    })
  })
})
