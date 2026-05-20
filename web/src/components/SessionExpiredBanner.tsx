interface Props {
  onSignIn: () => void
}

export default function SessionExpiredBanner({ onSignIn }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        zIndex: 9999,
        gap: '1rem',
        fontFamily: 'sans-serif',
        color: '#fff',
      }}
    >
      <p style={{ fontSize: '1.1rem', margin: 0 }}>Your session has expired.</p>
      <button
        onClick={onSignIn}
        style={{ padding: '0.5rem 1.25rem', cursor: 'pointer', fontSize: '1rem' }}
      >
        Sign in again
      </button>
    </div>
  )
}
