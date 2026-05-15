import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/polyfills.ts', './src/test/setup.ts'],
    globals: true,
    // vmThreads avoids timeout on WSL2+Windows FS (jsdom init ~74s > 60s limit)
    // forks is used in CI (native Linux) to avoid vmThreads segfault during jsdom teardown
    pool: process.env.CI ? 'forks' : 'vmThreads',
  },
})
