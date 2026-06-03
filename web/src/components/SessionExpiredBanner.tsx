import styles from './SessionExpiredBanner.module.css'

interface Props {
  onSignIn: () => void
}

export default function SessionExpiredBanner({ onSignIn }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-heading"
      className={styles.sessionExpiredBanner}
    >
      <p id="session-expired-heading" className={styles.message}>Your session has expired.</p>
      <button onClick={onSignIn} className={styles.signInButton}>
        Sign in again
      </button>
    </div>
  )
}
