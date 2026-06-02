import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/AuthContext.tsx'
import App from './App.tsx'

const e2eToken = (window as unknown as Record<string, unknown>).__E2E_AUTH_TOKEN as string | undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider initialToken={e2eToken}>
      <App />
    </AuthProvider>
  </StrictMode>,
)
