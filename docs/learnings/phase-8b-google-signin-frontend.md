# Learnings: 8-B Google Sign-In (frontend)

- The spec did not include an OAuth `state` CSRF parameter in the PKCE flow scenarios. Hawk caught this in round 1 — without `state`, an attacker can craft a redirect URI that causes the app to exchange an attacker-controlled `code`. The PKCE verifier alone doesn't protect against this because it lives in `sessionStorage` and is correlated with the code, but there is no binding to the initiating session. **Action:** Breaker's auth spec template must include a mandatory "state generation, storage, and validation" scenario. — Done (state check added to `AuthContext.tsx`; `buildAuthUrl` now requires the parameter).

- The `.catch(() => {})` on token exchange left users stuck: the `?code=` query param was already stripped and the verifier deleted from `sessionStorage`, so neither the sign-in button nor the exchange could retry. Hawk caught this on the first review. **Action:** Any async auth flow that removes its own recovery path (URL params, sessionStorage entries) before the async call completes must guarantee the error path re-shows the sign-in screen. A `.catch(() => { setIdToken(null) })` with an explicit intent comment is the pattern. — Done.

- Existing test files that render `<App />` broke after the auth gate was added because `render(<App />)` without an `AuthProvider` resolved `useAuth()` to the default context (`idToken: null`), rendering `<SignInPage>` instead of the app. The fix — wrapping with `<AuthProvider initialToken="test-token">` — was a one-line change, but required a debug cycle to diagnose. **Action:** When a slice adds an auth gate to `App`, Breaker must list "wrap all existing `render(<App />)` calls in an `AuthProvider initialToken=...`" as an explicit step in the migration section of the spec. — Done (pattern applied; added to checklist going forward).

## Applied status

| Learning | Status |
|---|---|
| 1. Missing CSRF `state` parameter | Applied — state param added to `buildAuthUrl`, `signIn()`, and callback validation |
| 2. Silent auth failure leaves user stuck | Applied — `.catch(() => { setIdToken(null) })` added with comment |
| 3. Auth gate breaks existing render(<App />) tests | Applied — `renderApp()` helper with `AuthProvider initialToken` added to FolderNavigation and FolderMutations test files |
