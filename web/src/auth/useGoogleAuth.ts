import { useCallback, useEffect, useRef } from 'react'
import { attemptSilentRefresh } from './silentRefresh'

export const REFRESH_LEAD_MS = 5 * 60 * 1000

export function getExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

export function useGoogleAuth({
  clientId,
  onRefreshSuccess,
  onRefreshFailure,
}: {
  clientId: string
  onRefreshSuccess: (token: string) => void
  onRefreshFailure: () => void
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbacksRef = useRef({ onRefreshSuccess, onRefreshFailure })

  // Intentionally no dep array — runs after every render to keep ref in sync
  // without adding callbacks to scheduleRefresh's dep array (which would reset the timer).
  useEffect(() => {
    callbacksRef.current = { onRefreshSuccess, onRefreshFailure }
  })

  const cancelRefresh = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleRefresh = useCallback(
    (exp: number) => {
      cancelRefresh()
      const delay = exp * 1000 - Date.now() - REFRESH_LEAD_MS
      if (delay <= 0) {
        callbacksRef.current.onRefreshFailure()
        return
      }
      timerRef.current = setTimeout(async () => {
        timerRef.current = null
        const newToken = await attemptSilentRefresh(clientId)
        if (newToken) {
          // onRefreshSuccess sets idToken, which triggers the AuthContext useEffect
          // that calls scheduleRefresh — no need to reschedule explicitly here.
          callbacksRef.current.onRefreshSuccess(newToken)
        } else {
          callbacksRef.current.onRefreshFailure()
        }
      }, delay)
    },
    [cancelRefresh, clientId],
  )

  useEffect(() => () => { cancelRefresh() }, [cancelRefresh])

  return { scheduleRefresh, cancelRefresh }
}
