# Learnings — Slice 11-G: Fix 401s during active sessions

## Root cause: two compounding failures

Browser timer throttling and iframe third-party cookie blocking are both real and common. Neither alone causes the failure; together they eliminate both layers of the 11-D refresh mechanism:

1. `setTimeout` in a backgrounded tab can be delayed by hours — the 5-minute lead time is irrelevant when the timer fires late.
2. `prompt=none` iframe refresh relies on third-party cookies. Chrome Privacy Sandbox and Safari ITP block this silently, so `attemptSilentRefresh` always returns `null`.

The fix requires two independent layers: a `visibilitychange` handler for tab wake-up, and a pre-flight expiry check in `apiFetch` as a last-resort guard.

## `jwtExpired` semantics must be consistent with all callsites

`jwtExpired` is called from two contexts with opposing requirements:

- **`loadPersistedToken`** needs `catch → return true` (conservative): reject corrupt/unparseable tokens from storage.
- **`apiFetch`** needs to skip non-JWT dev tokens like `'test-token'` that will throw in `atob`.

The wrong fix is to change `jwtExpired`'s catch to `return false` — this makes `loadPersistedToken` accept corrupt tokens. The right fix is to add a **structural guard** at the `apiFetch` callsite only:

```typescript
if (token && token.split('.').length === 3 && jwtExpired(token)) {
  triggerUnauthorized()
  return Promise.resolve(new Response(null, { status: 401 }))
}
```

`jwtExpired` itself stays conservatively correct (`catch → return true`). Callsites with different needs add local guards rather than changing the shared function's semantics.

## Forward-ref pattern for circular hook initialisation

When `handleRefreshFailure` must be declared before `useGoogleAuth` (which returns `cancelRefresh`), but `handleRefreshFailure` needs to call `cancelRefresh`, use a ref:

```typescript
const cancelRefreshRef = useRef<() => void>(() => {})

const handleRefreshFailure = useCallback(() => {
  cancelRefreshRef.current()   // calls whatever is in the ref at invocation time
  clearToken()
  setIdToken(null)
  setSessionExpired(true)
}, [])

const { scheduleRefresh, cancelRefresh } = useGoogleAuth({ ... })

// cancelRefresh is stable (no deps) — populate ref after useGoogleAuth returns
useEffect(() => { cancelRefreshRef.current = cancelRefresh }, [cancelRefresh])
```

This avoids `Cannot access 'cancelRefresh' before initialization` (TDZ) while keeping both functions properly typed.

## Testing tab visibility with fake timers: use `vi.setSystemTime`, not `advanceTimersByTime`

Background tab throttling is simulated by advancing the system clock *without* firing timers. `vi.advanceTimersByTime(N)` fires all pending timers with delays ≤ N — the opposite of what happens in a real background tab. `vi.setSystemTime(new Date(Date.now() + N))` moves the clock without firing anything:

```typescript
vi.useFakeTimers()
const token = makeToken(65)  // expires in 65 minutes
render(<AuthProvider initialToken={token}><App /></AuthProvider>)

// advance clock past expiry without firing the refresh timer
vi.setSystemTime(new Date(Date.now() + 66 * 60 * 1000))

Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true, writable: true })
await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })

expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
```

## Pre-flight guard must not reject non-JWT dev tokens

The structural guard `token.split('.').length === 3` ensures `jwtExpired` is only called for real JWTs. Dev/test tokens like `'test-token'` or `'no-auth'` have fewer than 3 parts and are passed through unchanged — the existing `401` response handler covers those cases if the server rejects them.
