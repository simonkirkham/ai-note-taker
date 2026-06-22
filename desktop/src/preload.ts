import { contextBridge } from 'electron'

// Minimal, sandbox-safe bridge. Exposes only a desktop marker so the frontend
// can feature-detect the shell later (e.g. 31-B). No Node, no IPC surface yet.
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
})
