# Phase 6.5-B — Vitest Scaffold

**Slice:** 6.5-B  
**Date:** 2026-05-14  
**PR:** #37

## What was done

Installed the component test layer: Vitest 2, React Testing Library, MSW 2, jsdom. Wired `npm run test` into both `pr.yml` (frontend job, before Build) and `deploy.yml` (validate job). Two smoke tests prove the scaffold end-to-end: one RTL render check, one MSW fetch interception check. Added `tsconfig.test.json` to hold test-only type declarations, keeping `tsconfig.app.json` clean.

## Learnings

### Bleeding-edge Vitest versions introduce lock-file instability across npm/Node versions

Vitest 4.x (installed initially) uses Rolldown, a Rust-based bundler, which pulls in platform-native bindings (`@rolldown/binding-linux-x64-gnu`) and a WASM fallback (`@rolldown/binding-wasm32-wasi`). The WASM fallback in turn requires `@emnapi/core` and `@emnapi/runtime`. On the development machine (npm 11, Node 24, WSL2), npm omitted these from the `node_modules` section of the lock file because the WASM package was optional and not applicable to the current platform. CI (npm 10, Node 20, ubuntu-latest) then rejected `npm ci` with "Missing: @emnapi/core@1.10.0 from lock file".

**Rule:** when installing a test runner or bundler tool, reach for the current stable major (Vitest 2.x at time of writing) rather than the absolute latest. The stable major has predictable lock-file behaviour across npm versions. Upgrade to a new major only when it has been stable for several months and you can validate the lock file on the exact same npm/Node version as CI.

### vmThreads is the correct Vitest pool for WSL2 with Windows filesystem

On `/mnt/c/` (Windows NTFS accessed via WSL2), jsdom initialisation takes approximately 74 seconds due to the overhead of traversing node_modules over the 9P filesystem layer. The default `forks` and `threads` pools have a 60-second worker startup timeout and never proceed. The `vmThreads` pool has a longer internal timeout and successfully starts.

**Downside of vmThreads:** its sandboxed VM context strips Web Streams globals (`TransformStream`, `ReadableStream`, `WritableStream`) that `@mswjs/interceptors` reads at module load time. Fix: a `polyfills.ts` setupFile listed first in `setupFiles` imports these from `node:stream/web` and assigns them to `globalThis` before MSW's interceptor module is evaluated.

**Rule:** in `vite.config.ts`, leave a comment explaining the pool choice. Without it, the next engineer will see a non-default setting and remove it trying to "clean things up", breaking local tests.

### Keep test-only TypeScript types out of tsconfig.app.json

Adding `"types": ["vitest/globals", "node"]` directly to `tsconfig.app.json` means `describe`, `it`, `expect`, `process`, and `Buffer` are valid identifiers in every application source file. A developer can accidentally call `expect(x).toBe(y)` in production code without a type error. The correct pattern:

- `tsconfig.app.json`: no extra types; excludes `src/test/` and `src/__tests__/`
- `tsconfig.test.json`: extends `tsconfig.app.json`, re-includes all of `src/`, adds `"types": ["vitest/globals", "node"]`
- CI: runs `tsc -p tsconfig.app.json --noEmit` **and** `tsc -p tsconfig.test.json --noEmit` as separate steps

This catches type errors in both application code and test files while preventing cross-contamination.

### Test step belongs before Build in CI, not after

The production Vite build (`npm run build`) takes longer than the component test suite. Placing the test step after Build delays feedback when a test fails — developers wait for the bundle to finish before learning their change broke a test. Order should be: Lint → Typecheck → Test → Build. A build failure is a harder error (usually a missing file or broken import) that's visible in the editor; a test failure is the more common catch.

### @types/node must match the CI Node version

`@types/node@^25` was installed initially (npm resolved the latest available). CI runs Node 20. `@types/node` is versioned to match the Node runtime — using `^25` adds type signatures for APIs not present on Node 20, allowing non-portable code to pass `tsc`. Pin to `"@types/node": "^20"` to match the CI and production Lambda runtime. Bump it in lockstep with an actual Node version upgrade.
