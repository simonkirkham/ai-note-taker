import { requestWithResponse } from './client';

// Read-your-writes client helper (RYW): issue a token-gated read. Attach the pending write token
// (if any) in `If-Consistent-With` so the server waits until the async projector has applied the
// write; on a `stale` response retry a bounded number of times (each retry re-sends the token so
// the server waits again as the projector catches up). After a non-stale read, run `onFresh` to
// clear the token — the projection is confirmed caught up. Shared by the note (RYW-2) and action
// (RYW-3a) read flows.
const STALE_RETRIES = 2;
const STALE_RETRY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The read, plus whether the gate gave up on a still-lagging projection. A caller that already
// holds good data needs that flag: a `stale` body is the projector's OLDER state, so storing it
// regresses what the caller has (BUG-48).
export interface GatedResult<T> {
  body: T;
  stale: boolean;
}

export async function gatedReadResult<T>(
  path: string,
  token: string | null,
  onFresh: () => void,
): Promise<GatedResult<T>> {
  const headers: Record<string, string> = token ? { 'If-Consistent-With': token } : {};
  for (let attempt = 0; ; attempt++) {
    const { body, response } = await requestWithResponse<T>(path, { headers });
    const stale = response.headers.get('X-Consistency') === 'stale';
    if (!stale) {
      onFresh();
      return { body, stale: false };
    }
    if (attempt >= STALE_RETRIES) return { body, stale: true };
    await sleep(STALE_RETRY_DELAY_MS);
  }
}

export async function gatedRead<T>(path: string, token: string | null, onFresh: () => void): Promise<T> {
  const { body } = await gatedReadResult<T>(path, token, onFresh);
  return body;
}
