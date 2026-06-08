import './styles/tokens.css'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrototypeRoot } from './prototype/PrototypeRoot'

// PROTOTYPE BRANCH ONLY — renders the throwaway search-bar prototype instead of
// the real App. Never commit this swap to main or a slice branch.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrototypeRoot />
  </StrictMode>,
)
