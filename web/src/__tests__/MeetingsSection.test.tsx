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

describe('MeetingsSection — Create Note button', () => {
  beforeEach(() => stubNotificationPermission('granted'))

  it('shows Create Note when linkedNoteId is null', async () => {
    server.use(
      http.get('/api/calendar/today', () =>
        HttpResponse.json({ meetings: [meeting2] }),
      ),
    )
    renderSection()
    await screen.findByText('Team standup')
    expect(screen.getByRole('button', { name: 'Create Note' })).toBeInTheDocument()
  })

  it('shows Open Note when linkedNoteId is set', async () => {
    server.use(
      http.get('/api/calendar/today', () =>
        HttpResponse.json({ meetings: [{ ...meeting2, linkedNoteId: 'note-abc' }] }),
      ),
    )
    renderSection()
    await screen.findByText('Team standup')
    expect(screen.getByRole('button', { name: 'Open Note ↗' })).toBeInTheDocument()
  })

  it('clicking Create Note calls the API and navigates to the new note', async () => {
    server.use(
      http.get('/api/calendar/today', () =>
        HttpResponse.json({ meetings: [meeting2] }),
      ),
      http.post('/api/notes/from-meeting', () =>
        HttpResponse.json({ noteId: 'new-note-123' }, { status: 201 }),
      ),
    )
    const { onOpenNote } = renderSection()
    await screen.findByRole('button', { name: 'Create Note' })
    await userEvent.click(screen.getByRole('button', { name: 'Create Note' }))

    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('new-note-123', 'Team standup'))
  })

  it('button shows Creating… while the request is in-flight', async () => {
    let resolve: (v: Response) => void
    server.use(
      http.get('/api/calendar/today', () =>
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
      http.get('/api/calendar/today', () =>
        HttpResponse.json({ meetings: [{ ...meeting2, linkedNoteId: 'note-xyz' }] }),
      ),
    )
    const { onOpenNote } = renderSection()
    await screen.findByRole('button', { name: 'Open Note ↗' })
    await userEvent.click(screen.getByRole('button', { name: 'Open Note ↗' }))

    expect(onOpenNote).toHaveBeenCalledWith('note-xyz')
  })

  it('shows an inline error when note creation fails', async () => {
    server.use(
      http.get('/api/calendar/today', () =>
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
    expect(screen.getByRole('button', { name: 'Create Note' })).toBeEnabled()
  })
})
