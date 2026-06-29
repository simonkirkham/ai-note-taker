import { createContext, useContext } from 'react'

export type ToastVariant = 'info' | 'error'

export interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void
  showError: (message: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
