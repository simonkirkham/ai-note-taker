// Class component by necessity: error boundaries are the one sanctioned
// exception to the function-components-only rule. React provides no hook
// equivalent for getDerivedStateFromError / componentDidCatch.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught an error', error, info)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
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
