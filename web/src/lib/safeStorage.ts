// BUG-60: `localStorage`/`sessionStorage` access THROWS rather than returning null in a browser
// that refuses storage — private/incognito mode, a blocked third-party context, or at quota. Every
// unguarded call site is therefore a crash, and one of them (`AuthContext`'s calendar-return probe)
// runs DURING RENDER, so it took the whole tree down on any OAuth return.
//
// These accessors degrade instead: a read gives null, a write is dropped. Losing a stashed
// deep-link or PKCE verifier costs one re-authorisation; crashing costs the app. Same shape the
// RYW token store (`api/consistencyTokens.ts`) has always used — this is that shape lifted out so
// no call site needs a fifth inline try/catch.

function store(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

export function safeStorageGet(kind: 'session' | 'local', key: string): string | null {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeStorageSet(kind: 'session' | 'local', key: string, value: string): void {
  try {
    store(kind)?.setItem(key, value);
  } catch {
    // Storage refused (private mode, quota) — the value is simply not persisted.
  }
}

export function safeStorageRemove(kind: 'session' | 'local', key: string): void {
  try {
    store(kind)?.removeItem(key);
  } catch {
    // ignore
  }
}

export const safeSession = {
  get: (key: string) => safeStorageGet('session', key),
  set: (key: string, value: string) => safeStorageSet('session', key, value),
  remove: (key: string) => safeStorageRemove('session', key),
};

export const safeLocal = {
  get: (key: string) => safeStorageGet('local', key),
  set: (key: string, value: string) => safeStorageSet('local', key, value),
  remove: (key: string) => safeStorageRemove('local', key),
};
