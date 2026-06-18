// Self-heal for stale dynamic-import chunks after a deploy.
//
// When a code-split chunk 404s — the tab holds an index.html that references a
// bundle a newer deploy superseded, or a flaky network drops the request — Vite
// fires a `vite:preloadError` event on window. We reload once to pull the current
// index.html, guarded by a sessionStorage flag so a chunk that is genuinely gone
// cannot trigger an infinite reload loop: the second failure falls through to the
// ErrorBoundary (a recoverable "Reload" fallback) instead of reloading again.
//
// The flag is cleared once the app boots successfully (see main.tsx), so each
// deploy incident self-heals once rather than locking out one reload forever.
const RELOAD_FLAG = 'chunk-reload-attempted'

export function installChunkReloadHandler(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    if (win.sessionStorage.getItem(RELOAD_FLAG) !== null) {
      // Already reloaded once and the chunk still fails: stop here and let the
      // failed dynamic import surface through the ErrorBoundary. Do not
      // preventDefault, so Vite's default (re-throw) still propagates.
      return
    }
    win.sessionStorage.setItem(RELOAD_FLAG, '1')
    // Suppress Vite's default throw so a reload — not a crash — is what happens.
    event.preventDefault()
    win.location.reload()
  })
}

export function clearChunkReloadFlag(win: Window = window): void {
  win.sessionStorage.removeItem(RELOAD_FLAG)
}

// Default stability window before re-arming the guard. Long enough to outlast the
// first navigation to any React.lazy route, so a chunk that is genuinely gone fails
// a SECOND time while the flag is still set and falls through to the ErrorBoundary
// rather than reloading again.
const STABILITY_DELAY_MS = 10_000

// Clear the guard flag only after the app has run stably for `delayMs`, NOT the
// instant the entry chunk evaluates. Once React.lazy routes exist, the entry chunk
// loading no longer proves every lazy chunk loaded: clearing synchronously at boot
// re-arms the guard before a later lazy-chunk failure, so a genuinely-missing chunk
// would reload-loop. Deferring the clear closes that window (see main.tsx / phase-26
// 26-B caveat).
export function clearChunkReloadFlagAfterStable(
  win: Window = window,
  delayMs: number = STABILITY_DELAY_MS,
): void {
  win.setTimeout(() => clearChunkReloadFlag(win), delayMs)
}
