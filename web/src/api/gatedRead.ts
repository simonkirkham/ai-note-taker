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

export async function gatedRead<T>(path: string, token: string | null, onFresh: () => void): Promise<T> {
  const headers: Record<string, string> = token ? { 'If-Consistent-With': token } : {};
  for (let attempt = 0; ; attempt++) {
    const { body, response } = await requestWithResponse<T>(path, { headers });
    const stale = response.headers.get('X-Consistency') === 'stale';
    if (!stale) {
      onFresh();
      return body;
    }
    if (attempt >= STALE_RETRIES) return body;
    await sleep(STALE_RETRY_DELAY_MS);
  }
}
