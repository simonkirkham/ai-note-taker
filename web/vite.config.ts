import { availableParallelism } from 'node:os'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Local (WSL) vmThreads worker cap. Over-subscribed workers thrash the Windows
// filesystem instead of using the extra cores: on a 16-core box, uncapped runs
// failed 8 and then 33 tests in 1214 s / 835 s, with 9179 s cumulative in setup
// alone, on files that cannot fail for a real reason. Capped to 2 the same tree
// was 1032 passed / 139 s with 872 s of setup. Capping is faster AND reliable —
// it is not a speed/safety trade. 3 was measurably marginal (a later run still
// failed 5), so the safe default is 2, bounded below by tiny machines.
// Deliberately NOT derived from core count: the contention is filesystem and
// concurrent-session bound, not CPU bound, so more cores do not buy more workers.
// CI is unaffected — it runs the forks pool at full parallelism.
const LOCAL_MAX_THREADS = Math.max(1, Math.min(2, availableParallelism() - 1))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/polyfills.ts', './src/test/setup.ts'],
    globals: true,
    // vmThreads avoids timeout on WSL2+Windows FS (jsdom init ~74s > 60s limit)
    // forks is used in CI (native Linux) to avoid vmThreads segfault during jsdom teardown
    // Never force CI=true locally to "fix" a flaky run: forks segfaults on WSL
    // (53 "Failed to start forks worker", 44 of 97 files never ran).
    pool: process.env.CI ? 'forks' : 'vmThreads',
    // Top-level `maxWorkers` — NOT `poolOptions.vmThreads.maxThreads`, which
    // Vitest 4 removed. It is accepted silently as a deprecated no-op, so the
    // cap would look configured and never apply. CI keeps full parallelism.
    ...(process.env.CI ? {} : { maxWorkers: LOCAL_MAX_THREADS }),
  },
})
