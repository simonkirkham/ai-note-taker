# Phase 19-D — Context provider performance (memoise Auth & Toast values)

**Slice:** 19-D · **PR:** #201 · **Deployed:** 2026-06-09

## What shipped

- `AuthContext.tsx`: wrapped `signIn`/`signOut` in `useCallback`; `useMemo`'d the provider `value`.
- `ToastProvider.tsx`: `useMemo`'d the provider `value` (callbacks were already `useCallback`-stable).
- New `ContextMemoization.test.tsx` regression guard.
- Deferred the optional Auth state/actions context split — extra consumer churn, no measured need.

## The one non-obvious lesson — testing context-value memoisation

To prove a provider's `value` is referentially stable, you must force the **provider** to re-render *without* changing its own state, then assert the captured value identity is unchanged. The trap:

```tsx
// WRONG — never re-renders the provider, so the guard can't fail.
<Bumper>                      {/* holds the counter state */}
  <AuthProvider>             {/* passed as `children` — a stable element */}
    <Capture />
  </AuthProvider>
</Bumper>
```

When the provider is passed as a `children` prop, bumping the parent's state re-renders the parent but React reconciles the **same element reference** for `children` and skips the subtree — the provider never re-renders, `values.length` stays 1, and the test passes whether or not the value is memoised (a tautology).

```tsx
// RIGHT — provider rendered inline inside the stateful component, so each bump
// re-creates the provider element and forces it to re-render.
function Harness() {
  const [n, setN] = useState(0)
  return (
    <>
      <button onClick={() => setN(v => v + 1)}>bump {n}</button>
      <AuthProvider initialToken="tok"><Capture /></AuthProvider>
    </>
  )
}
```

Verify the guard by reverting the memo to an inline literal — both assertions must fail (Hawk did exactly this to confirm it isn't a tautology). Also assert the memo yields a **fresh** value on a real state change (e.g. `signOut` flips `idToken`) so a future over-frozen `[]` dep array is caught.

## Dependency-array notes (no stale closures)

- `signIn` reads only `clientId` → `[clientId]`. `signOut` reads `clientId` + `cancelRefresh` → `[clientId, cancelRefresh]`; `cancelRefresh` is a `useCallback(…, [])` in `useGoogleAuth`, stable for the provider lifetime.
- `clientId` is recomputed from `import.meta.env` every render but is effectively constant, so depending on it never churns the callbacks.
- Behaviour is unchanged in the E2E auth path: with `initialToken` seeded, `AuthProvider` has no auth-state churn and renders once at mount — the memoisation is behaviourally inert there (relevant when triaging an unrelated E2E flake, see below).
