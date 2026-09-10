// @vitest-environment node
// Node env deliberately: vite.config.ts resolves paths via `fileURLToPath(import.meta.url)`,
// which throws ERR_INVALID_URL_SCHEME under jsdom. Same opt-out the Favicon suite uses.
import { getConfig } from '@testing-library/dom'

// TI-61. The raised budgets are local-only, and this asserts that rather than trusting the
// mirroring of LOCAL_MAX_THREADS. It matters in one direction: a raised budget leaking into
// CI would hide a genuine hang, and it would do so silently — the suite would still be green.
// Running this test IN CI is what makes CI its own positive control, so the leak fails a build
// instead of being noticed by nobody.
describe('TI-61 test budgets are local-only', () => {
  it('per-test timeout is raised locally and left at the default in CI', async () => {
    const config = (await import('../../vite.config')).default as {
      test: { testTimeout?: number; maxWorkers?: number }
    }

    if (process.env.CI) {
      expect(config.test.testTimeout).toBeUndefined()
      expect(config.test.maxWorkers).toBeUndefined()
    } else {
      expect(config.test.testTimeout).toBe(12_000)
      expect(config.test.maxWorkers).toBeGreaterThan(0)
    }
  })

  it('async util timeout is raised locally and left at the default in CI', () => {
    expect(getConfig().asyncUtilTimeout).toBe(process.env.CI ? 1000 : 4000)
  })
})
