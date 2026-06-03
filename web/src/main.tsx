import './styles/tokens.css'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/AuthContext.tsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import App from '@/App'
// Temporary — prototype branch only, never reaches main.
import { PrototypeRoot } from './prototype/PrototypeRoot'

const e2eToken = (window as unknown as Record<string, unknown>).__E2E_AUTH_TOKEN as string | undefined

// Visit /#prototype to view the Phase 15 prototype (bypasses auth). Prototype branch only.
const isPrototype = window.location.hash.startsWith('#prototype')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPrototype ? (
      <PrototypeRoot />
    ) : (
      <ErrorBoundary>
        <AuthProvider initialToken={e2eToken}>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    )}
  </StrictMode>,
)
