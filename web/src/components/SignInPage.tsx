import { useAuth } from '../auth/AuthContext'

export default function SignInPage() {
  const { signIn } = useAuth()

  return (
    <div className="sign-in-page">
      <h1>AI Note Taker</h1>
      <button onClick={signIn}>Sign in with Google</button>
    </div>
  )
}
