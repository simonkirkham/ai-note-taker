import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AgendaPrototype from './AgendaPrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AgendaPrototype />
  </StrictMode>,
);
