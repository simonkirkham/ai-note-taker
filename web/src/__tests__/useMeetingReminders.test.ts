import { renderHook } from '@testing-library/react'
import { useMeetingReminders, MeetingReminder } from '../hooks/useMeetingReminders'

const FUTURE = new Date(Date.now() + 60_000).toISOString()
const PAST = new Date(Date.now() - 60_000).toISOString()

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

const NotificationMock = vi.fn()

function stubNotificationConstructor(permission: NotificationPermission) {
  NotificationMock.mockClear()
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: Object.assign(NotificationMock, {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission),
    }),
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useMeetingReminders', () => {
  it('schedules a setTimeout for a future meeting', () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    stubNotificationPermission('granted')

    const meetings: MeetingReminder[] = [
      { calendarEventId: 'e-1', title: 'Standup', startTime: FUTURE },
    ]
    renderHook(() => useMeetingReminders(meetings))

    expect(setTimeoutSpy).toHaveBeenCalledOnce()
  })

  it('does not schedule a setTimeout for a past meeting', () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    stubNotificationPermission('granted')

    const meetings: MeetingReminder[] = [
      { calendarEventId: 'e-2', title: 'Old meeting', startTime: PAST },
    ]
    renderHook(() => useMeetingReminders(meetings))

    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  it('fires a Notification when permission is granted', () => {
    vi.useFakeTimers()
    stubNotificationConstructor('granted')

    const meetings: MeetingReminder[] = [
      { calendarEventId: 'e-3', title: 'Planning', startTime: FUTURE },
    ]
    renderHook(() => useMeetingReminders(meetings))

    vi.runAllTimers()

    expect(NotificationMock).toHaveBeenCalledOnce()
    expect(NotificationMock).toHaveBeenCalledWith('Planning', { body: 'Your meeting is starting now' })
  })

  it('shows an in-app fallback (alert) when permission is denied', () => {
    vi.useFakeTimers()
    stubNotificationPermission('denied')
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {})

    const meetings: MeetingReminder[] = [
      { calendarEventId: 'e-4', title: 'Retro', startTime: FUTURE },
    ]
    renderHook(() => useMeetingReminders(meetings))

    vi.runAllTimers()

    expect(alertSpy).toHaveBeenCalledOnce()
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Retro'))
  })

  it('shows an in-app fallback (alert) when permission is default', () => {
    vi.useFakeTimers()
    stubNotificationPermission('default')
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {})

    const meetings: MeetingReminder[] = [
      { calendarEventId: 'e-5', title: 'Demo', startTime: FUTURE },
    ]
    renderHook(() => useMeetingReminders(meetings))

    vi.runAllTimers()

    expect(alertSpy).toHaveBeenCalledOnce()
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Demo'))
  })

  it('clears timers on unmount', () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    stubNotificationPermission('granted')

    const meetings: MeetingReminder[] = [
      { calendarEventId: 'e-6', title: 'Review', startTime: FUTURE },
    ]
    const { unmount } = renderHook(() => useMeetingReminders(meetings))

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalledOnce()
  })
})
