import './styles/tokens.css'
import './styles/global.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import ErrorBoundary from '@/components/ErrorBoundary'
import { ToastProvider } from '@/components/ToastProvider'
import { clearChunkReloadFlag, installChunkReloadHandler } from '@/lib/chunkReload'
import { AuthProvider } from './auth/AuthContext.tsx'

// Install before render so a dynamic import that fails during boot self-heals
// with one reload instead of crashing (paired with the ErrorBoundary fallback).
installChunkReloadHandler()

const e2eToken = (window as unknown as Record<string, unknown>).__E2E_AUTH_TOKEN as string | undefined

// apiFetch already handles 401/token refresh, so keep retry low. Modest staleTime
// + no refetch-on-focus avoids invalidation/refetch storms (see phase-20 observability).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {/* QueryClientProvider sits outside AuthProvider deliberately: query fns read
          the module-level token store (not React context) and apiFetch handles
          401-refresh, so no provider-ordering/auth-token race exists. */}
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider initialToken={e2eToken}>
            <App />
          </AuthProvider>
        </ToastProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// The entry chunk evaluated, so a prior entry-chunk reload (if any) succeeded —
// reset the guard so the next deploy's incident can self-heal once more. NOTE: this
// proves only the entry chunk loaded, not every lazy route. Once 19-I adds
// React.lazy routes, clearing here re-arms the guard before a later route-chunk
// failure, so a genuinely-missing route chunk could reload-loop instead of falling
// to the ErrorBoundary. Revisit the clear timing (e.g. clear after a stability
// delay) when the first React.lazy lands — see phase-26.md 26-B caveat.
clearChunkReloadFlag()
