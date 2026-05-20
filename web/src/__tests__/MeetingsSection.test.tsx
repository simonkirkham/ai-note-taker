import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/setup'
import MeetingsSection from '../components/MeetingsSection'

const meeting1 = {
  calendarEventId: 'evt1',
  title: '1:1 with Bill',
  startTime: '2026-05-20T09:00:00Z',
  endTime: '2026-05-20T09:30:00Z',
  isRecurring: true,
  recurringSeriesId: 'series1',
  linkedNoteId: null,
  hasNextOccurrenceNote: false,
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
}

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

function renderSection() {
  return render(<MeetingsSection />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MeetingsSection — meetings data', () => {
  beforeEach(() => stubNotificationPermission('granted'))
  it('shows meetings with title and time when calendar returns events', async () => {
    server.use(
      http.get('/api/calendar/today', () =>
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
      http.get('/api/calendar/today', () =>
        HttpResponse.json({ error: 'calendar_unavailable' }),
      ),
    )

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('meetings-unavailable')).toBeInTheDocument(),
    )
    expect(screen.getByText('Cannot connect to calendar')).toBeInTheDocument()
  })

  it('shows error message when calendar request throws', async () => {
    server.use(
      http.get('/api/calendar/today', () => HttpResponse.error()),
    )

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('meetings-unavailable')).toBeInTheDocument(),
    )
  })

  it('meetings appear in the list with titles visible', async () => {
    server.use(
      http.get('/api/calendar/today', () =>
        HttpResponse.json({ meetings: [meeting1] }),
      ),
    )

    renderSection()

    const title = await screen.findByText('1:1 with Bill')
    expect(title).toBeInTheDocument()
  })

  it('shows loading state on initial render before fetch resolves', () => {
    // useState initialises with { status: 'loading' } before the useEffect fetch fires
    renderSection()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
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
