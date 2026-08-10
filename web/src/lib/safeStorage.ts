// BUG-60: `localStorage`/`sessionStorage` access THROWS rather than returning null in a browser
// that refuses storage — private/incognito mode, a blocked third-party context, or at quota. Every
// unguarded call site is therefore a crash, and one of them (`AuthContext`'s calendar-return probe)
// runs DURING RENDER, so it took the whole tree down on any OAuth return.
//
// These accessors degrade instead: a read gives null, a write is dropped. Same shape the RYW token
// store (`api/consistencyTokens.ts`) has always used — lifted out so no call site needs a fifth
// inline try/catch.
//
// BUT a dropped write is NOT uniformly cheap, and treating it as such is how the first attempt at
// this fix made sign-in worse than the crash. Losing a stashed deep-link costs one navigation.
// Losing the PKCE verifier costs the WHOLE sign-in: before the guard, the throw at least stopped
// `window.location.href` being reached (the button looked dead); after it, the write vanished and
// the redirect still fired, so the OAuth return found no verifier, bailed before `replaceState`,
// and left the user on the sign-in page holding a spent `?code=` — an unbounded silent loop, for
// exactly the users this fix exists to serve.
//
// So a call site whose NEXT step is irreversible (a redirect) must not assume the write landed.
// `verifiedSet` reports whether the value can actually be read back, and those call sites refuse to
// proceed when it cannot. Guarding an access and checking that the guard's fallback is survivable
// are two different jobs; this module does the first, `verifiedSet` exists for the second.

// Accessing the PROPERTY can throw, not just the methods — a blocked third-party context is the
// usual cause. That throw is caught by each accessor below rather than here: an inner try/catch
// returning null would be indistinguishable in behaviour and is therefore a guard that cannot fire
// (docs/learnings/phase-bug65-guards-that-cannot-fire.md). Verified by deleting it — every test
// stayed green, which is the definition of dead.
function store(kind: 'session' | 'local'): Storage {
  return kind === 'session' ? sessionStorage : localStorage;
}

export function safeStorageGet(kind: 'session' | 'local', key: string): string | null {
  try {
    return store(kind).getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeStorageSet(kind: 'session' | 'local', key: string, value: string): void {
  try {
    store(kind).setItem(key, value);
  } catch {
    // Storage refused (private mode, quota) — the value is simply not persisted.
  }
}

export function safeStorageRemove(kind: 'session' | 'local', key: string): void {
  try {
    store(kind).removeItem(key);
  } catch {
    // ignore
  }
}

// Write, then read back. Returns false when the value did not survive — storage refused the write,
// threw on access, or (Safari private mode, historically) accepted `setItem` and stored nothing.
// A read-back is the only check that covers all three; `setItem` not throwing does not prove the
// value is there. Use this wherever the next step cannot be undone.
//
// What it CANNOT prove: that the value survives the redirect. Safari ITP / storage partitioning can
// clear sessionStorage on the cross-site return, which passes verifiedSet here and still loses the
// verifier there. That residual is why the callback-side handling is not optional — it strips the
// spent `?code=` and states the reason, so the worst case is one bounded failure, not a loop.
export function verifiedSet(kind: 'session' | 'local', key: string, value: string): boolean {
  safeStorageSet(kind, key, value);
  return safeStorageGet(kind, key) === value;
}

export const safeSession = {
  get: (key: string) => safeStorageGet('session', key),
  set: (key: string, value: string) => safeStorageSet('session', key, value),
  verifiedSet: (key: string, value: string) => verifiedSet('session', key, value),
  remove: (key: string) => safeStorageRemove('session', key),
};

export const safeLocal = {
  get: (key: string) => safeStorageGet('local', key),
  set: (key: string, value: string) => safeStorageSet('local', key, value),
  verifiedSet: (key: string, value: string) => verifiedSet('local', key, value),
  remove: (key: string) => safeStorageRemove('local', key),
};
