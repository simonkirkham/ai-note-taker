# Learnings: Auth token persistence hotfix

- Auth token was stored only in a module-level JS variable, so any page refresh silently dropped the user to sign-in. **Action:** Persist token in `localStorage` via `setToken`/`clearToken`; restore on mount via `loadPersistedToken()` with a JWT `exp` check so expired tokens are discarded rather than used — Done.

- React runs child component `useEffect` hooks before parent `useEffect` hooks (depth-first). `useNotes` and `AppContent` effects fire before `AuthProvider` sets the token, so initial `GET /api/notes` calls went out with no token and returned 401. Before the fix, these 401s were silently caught. After adding the `triggerUnauthorized` handler, the 401s cleared the token that had just been set, breaking all subsequent API calls. **Action:** Guard `triggerUnauthorized` so it only fires when the request actually carried a token (`res.status === 401 && token`) — Done.

- When adding a global API error handler (401, 403, etc.), always verify the handler against requests made before authentication is established — otherwise unauthenticated initial-load requests can trigger sign-out flows incorrectly. **Action:** Added the `&& token` guard as the standard pattern for unauthorized handling in `api.ts` — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Persist token in localStorage with expiry check | Applied — `tokenStore.ts` `setToken`/`clearToken`/`loadPersistedToken` |
| 2. Guard `triggerUnauthorized` when request had a token | Applied — `api.ts` line 10: `res.status === 401 && token` |
| 3. Verify global error handlers against pre-auth requests | Applied — same `&& token` guard; documented here for future auth slices |
