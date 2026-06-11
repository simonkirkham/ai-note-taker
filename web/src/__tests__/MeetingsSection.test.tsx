import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import MeetingsSection from '../components/MeetingsSection'
import { useMeetingReminders } from '../hooks/useMeetingReminders'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

// The reminder hook is stubbed so we can assert exactly which meetings feed it.
vi.mock('../hooks/useMeetingReminders', () => ({ useMeetingReminders: vi.fn() }))
const mockedReminders = vi.mocked(useMeetingReminders)

const meeting1 = {
  calendarEventId: 'evt1',
  title: '1:1 with Bill',
  startTime: '2026-05-20T09:00:00Z',
  endTime: '2026-05-20T09:30:00Z',
  isRecurring: true,
  recurringSeriesId: 'series1',
  linkedNoteId: null,
  hasNextOccurrenceNote: false,
  nextOccurrenceNoteId: null,
}

const meeting2 = {
  calendarEventId: 'evt2',
  title: 'Team standup',
  startTime: '2026-05-20T14:00:00Z',
  endTime: '2026-05-20T14:15:00Z',
  isRecurring: false,
  recurringSeriesId: null,
  linkedNoteId: null,
  hasNextOccurrenceNote: false,
  nextOccurrenceNoteId: null,
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
const todayStr = ymd()

function stubNotificationPermission(permission: NotificationPermission) {
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission),
    },
  })
}

function renderSection(onOpenNote = vi.fn()) {
  return { onOpenNote, ...render(<MeetingsSection onOpenNote={onOpenNote} />) }
}

beforeEach(() => mockedReminders.mockClear())

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MeetingsSection — meetings data', () => {
  beforeEach(() => stubNotificationPermission('granted'))
  it('shows meetings with title and time when calendar returns events', async () => {
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ meetings: [meeting1, meeting2] }),
      ),
    )

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('meetings-list')).toBeInTheDocument(),
    )
    expect(screen.getByText('1:1 with Bill')).toBeInTheDocument()
    expect(screen.getByText('Team standup')).toBeInTheDocument()
  })

  it('shows empty state when there are no meetings today', async () => {
    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('meetings-empty')).toBeInTheDocument(),
    )
  })

  it('shows error message when calendar is unavailable', async () => {
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ error: 'calendar_unavailable' }),
      ),
    )

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('meetings-unavailable')).toBeInTheDocument(),
    )
    expect(screen.getByText('Cannot connect to calendar')).toBeInTheDocument()
    // 19-F1: calendar-unavailable is an error → assertive live region
    expect(screen.getByTestId('meetings-unavailable')).toHaveAttribute('role', 'alert')
  })

  it('shows error message when calendar request throws', async () => {
    server.use(
      http.get('/api/calendar/:date', () => HttpResponse.error()),
    )

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('meetings-unavailable')).toBeInTheDocument(),
    )
  })

  it('shows loading state on initial render before fetch resolves', () => {
    // useState initialises with { status: 'loading' } before the useEffect fetch fires
    renderSection()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

describe('MeetingsSection — date navigation', () => {
  beforeEach(() => stubNotificationPermission('granted'))

  it('opens on today with the "Today\'s Meetings" heading', async () => {
    renderSection()
    expect(await screen.findByTestId('meetings-empty')).toBeInTheDocument()
    expect(screen.getByTestId('meetings-heading')).toHaveTextContent("Today's Meetings")
  })

  it('stepping forward a day shows the next day and the "Tomorrow\'s Meetings" heading', async () => {
    server.use(
      http.get('/api/calendar/:date', ({ params }) =>
        HttpResponse.json({ meetings: params.date === todayStr ? [meeting1] : [meeting2] }),
      ),
    )
    renderSection()
    await screen.findByText('1:1 with Bill')

    await userEvent.click(screen.getByTestId('meetings-next-day'))

    await screen.findByText('Team standup')
    expect(screen.getByTestId('meetings-heading')).toHaveTextContent("Tomorrow's Meetings")
  })

  it('stepping back a day shows the previous day and the "Yesterday\'s Meetings" heading', async () => {
    server.use(
      http.get('/api/calendar/:date', ({ params }) =>
        HttpResponse.json({ meetings: params.date === todayStr ? [meeting1] : [meeting2] }),
      ),
    )
    renderSection()
    await screen.findByText('1:1 with Bill')

    await userEvent.click(screen.getByTestId('meetings-prev-day'))

    await screen.findByText('Team standup')
    expect(screen.getByTestId('meetings-heading')).toHaveTextContent("Yesterday's Meetings")
  })

  it('a day more than one away shows the formatted weekday/date heading', async () => {
    renderSection()
    await screen.findByTestId('meetings-empty')

    await userEvent.click(screen.getByTestId('meetings-next-day'))
    await userEvent.click(screen.getByTestId('meetings-next-day'))

    const twoDaysOut = new Date(`${todayStr}T00:00:00Z`)
    twoDaysOut.setUTCDate(twoDaysOut.getUTCDate() + 2)
    const weekday = twoDaysOut.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
    const heading = screen.getByTestId('meetings-heading')
    expect(heading).toHaveTextContent(/^Meetings — /)
    expect(heading).toHaveTextContent(weekday)
  })

  it('a browsed day with no meetings shows the empty state, not an error', async () => {
    server.use(
      http.get('/api/calendar/:date', ({ params }) =>
        HttpResponse.json({ meetings: params.date === todayStr ? [meeting1] : [] }),
      ),
    )
    renderSection()
    await screen.findByText('1:1 with Bill')

    await userEvent.click(screen.getByTestId('meetings-next-day'))

    expect(await screen.findByTestId('meetings-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('meetings-unavailable')).not.toBeInTheDocument()
  })
})

describe('MeetingsSection — date picker', () => {
  beforeEach(() => stubNotificationPermission('granted'))

  it('keeps the date input hidden until the calendar button is clicked', async () => {
    renderSection()
    await screen.findByTestId('meetings-empty')
    expect(screen.queryByTestId('meetings-date-input')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('meetings-date-picker-toggle'))

    expect(screen.getByTestId('meetings-date-input')).toBeInTheDocument()
  })

  it('picking a date updates the list and heading and closes the picker', async () => {
    server.use(
      http.get('/api/calendar/:date', ({ params }) =>
        HttpResponse.json({ meetings: params.date === todayStr ? [meeting1] : [meeting2] }),
      ),
    )
    renderSection()
    await screen.findByText('1:1 with Bill')

    await userEvent.click(screen.getByTestId('meetings-date-picker-toggle'))
    const input = screen.getByTestId('meetings-date-input')
    fireEvent.change(input, { target: { value: '2026-12-25' } })

    await screen.findByText('Team standup')
    expect(screen.getByTestId('meetings-heading')).toHaveTextContent('Meetings — ')
    expect(screen.queryByTestId('meetings-date-input')).not.toBeInTheDocument()
  })
})

describe('MeetingsSection — reminders stay anchored to today', () => {
  beforeEach(() => stubNotificationPermission('granted'))

  const remindersSawTitle = (title: string) =>
    mockedReminders.mock.calls.some(([meetings]) => meetings.some((m) => m.title === title))

  it('feeds the reminder hook today\'s meetings and never the browsed day\'s', async () => {
    server.use(
      http.get('/api/calendar/:date', ({ params }) =>
        HttpResponse.json({ meetings: params.date === todayStr ? [meeting1] : [meeting2] }),
      ),
    )
    renderSection()
    await screen.findByText('1:1 with Bill')

    expect(remindersSawTitle('1:1 with Bill')).toBe(true)

    await userEvent.click(screen.getByTestId('meetings-next-day'))
    await screen.findByText('Team standup')

    // browsing changed the displayed list but must never feed the reminder hook
    expect(remindersSawTitle('Team standup')).toBe(false)
  })

  it('does not refetch today when navigating away and back (reuses the today fetch)', async () => {
    let todayCalls = 0
    server.use(
      http.get('/api/calendar/:date', ({ params }) => {
        if (params.date === todayStr) todayCalls++
        return HttpResponse.json({ meetings: params.date === todayStr ? [meeting1] : [meeting2] })
      }),
    )
    renderSection()
    await screen.findByText('1:1 with Bill')

    await userEvent.click(screen.getByTestId('meetings-next-day'))
    await screen.findByText('Team standup')
    await userEvent.click(screen.getByTestId('meetings-prev-day'))
    await screen.findByText('1:1 with Bill')

    expect(todayCalls).toBe(1)
  })
})

describe('MeetingsSection — notification banner', () => {
  it('shows the banner when permission is default', () => {
    stubNotificationPermission('default')
    renderSection()
    expect(screen.getByTestId('notification-banner')).toBeInTheDocument()
  })

  it('hides the banner when permission is granted', () => {
    stubNotificationPermission('granted')
    renderSection()
    expect(screen.queryByTestId('notification-banner')).not.toBeInTheDocument()
  })

  it('hides the banner when permission is denied', () => {
    stubNotificationPermission('denied')
    renderSection()
    expect(screen.queryByTestId('notification-banner')).not.toBeInTheDocument()
  })

  it('clicking Enable calls requestPermission and hides the banner', async () => {
    stubNotificationPermission('default')
    renderSection()
    const enableBtn = screen.getByTestId('enable-notifications-button')
    await userEvent.click(enableBtn)
    expect(Notification.requestPermission).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('notification-banner')).not.toBeInTheDocument()
  })

  it('clicking ✕ hides the banner without calling requestPermission', async () => {
    stubNotificationPermission('default')
    renderSection()
    const dismissBtn = screen.getByTestId('dismiss-notification-banner')
    await userEvent.click(dismissBtn)
    expect(screen.queryByTestId('notification-banner')).not.toBeInTheDocument()
    expect(Notification.requestPermission).not.toHaveBeenCalled()
  })
})

describe('MeetingsSection — Create Note button', () => {
  beforeEach(() => stubNotificationPermission('granted'))

  it('shows Create Note when linkedNoteId is null', async () => {
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ meetings: [meeting2] }),
      ),
    )
    renderSection()
    await screen.findByText('Team standup')
    expect(screen.getByRole('button', { name: 'Create Note' })).toBeInTheDocument()
  })

  it('shows Open Note when linkedNoteId is set', async () => {
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ meetings: [{ ...meeting2, linkedNoteId: 'note-abc' }] }),
      ),
    )
    renderSection()
    await screen.findByText('Team standup')
    expect(screen.getByRole('button', { name: 'Open Note ↗' })).toBeInTheDocument()
  })

  it('clicking Create Note calls the API and navigates to the new note with isNew flag', async () => {
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ meetings: [meeting2] }),
      ),
      http.post('/api/notes/from-meeting', () =>
        HttpResponse.json({ noteId: 'new-note-123' }, { status: 201 }),
      ),
    )
    const { onOpenNote } = renderSection()
    await screen.findByRole('button', { name: 'Create Note' })
    await userEvent.click(screen.getByRole('button', { name: 'Create Note' }))

    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('new-note-123', 'Team standup', true))
  })

  it('button shows Creating… while the request is in-flight', async () => {
    let resolve: (v: Response) => void
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ meetings: [meeting2] }),
      ),
      http.post('/api/notes/from-meeting', () =>
        new Promise<Response>((res) => { resolve = res }),
      ),
    )
    renderSection()
    await screen.findByRole('button', { name: 'Create Note' })
    await userEvent.click(screen.getByRole('button', { name: 'Create Note' }))

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeInTheDocument()
    resolve!(HttpResponse.json({ noteId: 'n1' }, { status: 201 }) as unknown as Response)
  })

  it('clicking Open Note calls onOpenNote with the linked noteId', async () => {
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ meetings: [{ ...meeting2, linkedNoteId: 'note-xyz' }] }),
      ),
    )
    const { onOpenNote } = renderSection()
    await screen.findByRole('button', { name: 'Open Note ↗' })
    await userEvent.click(screen.getByRole('button', { name: 'Open Note ↗' }))

    expect(onOpenNote).toHaveBeenCalledWith('note-xyz')
  })

  it('creating a note works on a browsed day exactly as today', async () => {
    server.use(
      http.get('/api/calendar/:date', ({ params }) =>
        HttpResponse.json({ meetings: params.date === todayStr ? [meeting1] : [meeting2] }),
      ),
      http.post('/api/notes/from-meeting', () =>
        HttpResponse.json({ noteId: 'browsed-note-1' }, { status: 201 }),
      ),
    )
    const { onOpenNote } = renderSection()
    await screen.findByText('1:1 with Bill')

    await userEvent.click(screen.getByTestId('meetings-next-day'))
    await screen.findByText('Team standup')
    await userEvent.click(screen.getByRole('button', { name: 'Create Note' }))

    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('browsed-note-1', 'Team standup', true))
  })

  it('shows an inline error when note creation fails', async () => {
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ meetings: [meeting2] }),
      ),
      http.post('/api/notes/from-meeting', () =>
        HttpResponse.json({ error: 'server_error' }, { status: 500 }),
      ),
    )
    renderSection()
    await screen.findByRole('button', { name: 'Create Note' })
    await userEvent.click(screen.getByRole('button', { name: 'Create Note' }))

    await waitFor(() =>
      expect(screen.getByTestId(`create-error-${meeting2.calendarEventId}`)).toBeInTheDocument(),
    )
    // 19-F1: a per-meeting create failure is silent to screen readers today
    expect(screen.getByRole('alert')).toHaveTextContent(
      screen.getByTestId(`create-error-${meeting2.calendarEventId}`).textContent ?? '',
    )
    expect(screen.getByRole('button', { name: 'Create Note' })).toBeEnabled()
  })
})

describe('MeetingsSection — next occurrence Create Note button', () => {
  beforeEach(() => stubNotificationPermission('granted'))

  it('clicking Create Note on next-occurrence row opens the note with the meeting title', async () => {
    server.use(
      http.get('/api/calendar/:date', () =>
        HttpResponse.json({ meetings: [meeting1] }),
      ),
      http.post('/api/notes/from-next-occurrence', () =>
        HttpResponse.json({ noteId: 'next-note-456', nextOccurrence: { calendarEventId: 's1_next', startTime: '2026-05-27T09:00:00Z', endTime: '2026-05-27T09:30:00Z' } }, { status: 201 }),
      ),
    )
    const { onOpenNote } = renderSection()
    await screen.findByText('1:1 with Bill')

    const createBtns = screen.getAllByRole('button', { name: 'Create Note' })
    // meeting1 is recurring — second Create Note button is the next-occurrence row
    await userEvent.click(createBtns[1])

    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('next-note-456', '1:1 with Bill', true))
  })
})
