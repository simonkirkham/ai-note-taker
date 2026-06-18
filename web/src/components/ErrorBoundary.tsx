// Class component by necessity: error boundaries are the one sanctioned
// exception to the function-components-only rule. React provides no hook
// equivalent for getDerivedStateFromError / componentDidCatch.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

interface ErrorBoundaryProps {
  children: ReactNode
  // Localised fallback (e.g. a single failed lazy chunk) instead of the default
  // whole-page "Something went wrong". When omitted, the default card renders.
  fallback?: ReactNode
  // Notified with the caught error — used to forward a failed lazy-chunk load to
  // RUM (19-I1). Runs in componentDidCatch, so a throw here is swallowed by React.
  onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught an error', error, info)
    this.props.onError?.(error, info)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback
      }
      return (
        <div role="alert" className={styles.fallback}>
          <div className={styles.card}>
            <h1 className={styles.heading}>Something went wrong</h1>
            <p className={styles.message}>
              An unexpected error occurred. Reloading the page usually fixes it.
            </p>
            <button type="button" className={styles.reloadButton} onClick={this.handleReload}>
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
