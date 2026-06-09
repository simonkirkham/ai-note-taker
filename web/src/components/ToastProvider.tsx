import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ToastContext, type ToastVariant } from './toastContext'
import styles from './ToastProvider.module.css'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

const AUTO_DISMISS_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, message, variant }])
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  const showError = useCallback((message: string) => showToast(message, 'error'), [showToast])

  const value = useMemo(() => ({ showToast, showError }), [showToast, showError])

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.stack} aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={toast.variant === 'error' ? styles.error : styles.info}
            role={toast.variant === 'error' ? 'alert' : 'status'}
          >
            <span className={styles.message}>{toast.message}</span>
            <button
              type="button"
              className={styles.dismiss}
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
