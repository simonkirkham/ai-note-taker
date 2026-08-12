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

// TI-61. Local-only per-test budget. The default 5000 ms is not a hang detector on
// this box — it is an assertion about machine speed, and the machine varies.
// Measured under deliberate contention (32 CPU spinners, no other suites),
// `Routing.test.tsx > Back returns to the home screen` runs to 5780 ms with a median
// of 3966 ms — i.e. it exceeds the default ceiling on its own, and sits at 79% of it
// even when it passes. Same test, unloaded and alone: 293 ms.
// 12000 = worst observed (5780) x2, rounded up.
// IT IS SIZED ON THE FAILING FILE, NOT ON THE SUITE — the distinction matters to whoever
// reads this next. `staleDetailRefetch.test.tsx` and `staleCardsRefetch.test.tsx` have
// slower slowest-tests than Routing even unloaded (2455 ms / 2437 ms vs 1125 ms) and are
// equally work-bound (no fake timers, no sleeps). At the inflation Routing showed (~5.1x)
// they would land near 12500 ms and EXCEED this budget. That is an extrapolation — neither
// has been measured under contention — and sizing a budget off an unmeasured multiple is
// the guess-wearing-a-measurement's-clothes this investigation refused twice already. So
// the number stays at the measured one. If either file starts failing, measure IT under
// contention and raise this to its worst x2; do not raise it pre-emptively.
// Pulling the other way: these figures were taken while the pre-commit hook still ran full
// suites on every commit across parallel sessions, so ambient load here was higher than it
// will be from now on.
// CI keeps the 5000 ms default deliberately — it runs the frontend job alone on native
// Linux, so a real hang still fails there on the tighter budget.
const LOCAL_TEST_TIMEOUT_MS = 12_000

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
    ...(process.env.CI
      ? {}
      : { maxWorkers: LOCAL_MAX_THREADS, testTimeout: LOCAL_TEST_TIMEOUT_MS }),
  },
})
