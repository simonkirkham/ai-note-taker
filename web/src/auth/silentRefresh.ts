import { exchangeCode, generateCodeChallenge, generateCodeVerifier } from './pkce'

const SILENT_REFRESH_TIMEOUT_MS = 15_000

export function attemptSilentRefresh(clientId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const verifier = generateCodeVerifier()
    const state = generateCodeVerifier()
    const redirectUri = `${window.location.origin}/silent-refresh.html`

    generateCodeChallenge(verifier).then((challenge) => {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        prompt: 'none',
      })

      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.src = `https://accounts.google.com/o/oauth2/v2/auth?${params}`

      let settled = false

      const timeoutId = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        resolve(null)
      }, SILENT_REFRESH_TIMEOUT_MS)

      async function handleMessage(event: MessageEvent) {
        if (event.origin !== window.location.origin) return
        if ((event.data as { type?: string })?.type !== 'silent-refresh-callback') return
        if (settled) return
        settled = true
        cleanup()

        const urlParams = new URLSearchParams((event.data as { search: string }).search)
        const code = urlParams.get('code')
        const returnedState = urlParams.get('state')

        if (!code || returnedState !== state) {
          resolve(null)
          return
        }

        try {
          const { id_token } = await exchangeCode(redirectUri, code, verifier)
          resolve(id_token)
        } catch {
          resolve(null)
        }
      }

      function cleanup() {
        clearTimeout(timeoutId)
        window.removeEventListener('message', handleMessage)
        if (iframe.parentNode) document.body.removeChild(iframe)
      }

      window.addEventListener('message', handleMessage)
      document.body.appendChild(iframe)
    })
  })
}
