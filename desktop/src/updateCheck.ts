// 53-A — the main-process half of the update notice. The publish workflow keeps a short history
// of published updates next to the installer; the app reads it to say how far behind it is.
//
// Fetched here rather than in the renderer: the release-asset URL redirects to a download host
// that sends no CORS headers, so a renderer fetch would always fail. Every failure resolves to
// null (the notice stays hidden) and logs why — an update check that never succeeds is otherwise
// indistinguishable from one that keeps finding nothing new.

export type ReleaseEntry = { sha: string; builtAt: string }

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

// A hung request would otherwise stack one more pending check every hour.
const TIMEOUT_MS = 15_000

export const HISTORY_URL =
  'https://github.com/simonkirkham/ai-note-taker/releases/download/desktop-latest/releases.json'

export function parseHistory(text: string): ReleaseEntry[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  return raw.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const { sha, builtAt } = item as Record<string, unknown>
    return typeof sha === 'string' && typeof builtAt === 'string' ? [{ sha, builtAt }] : []
  })
}

export async function fetchHistory(
  fetchImpl: Fetch,
  warn: (message: string) => void = (m) => console.warn(m),
): Promise<ReleaseEntry[] | null> {
  try {
    const response = await fetchImpl(HISTORY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) {
      warn(`[desktop] update check: history returned ${response.status}`)
      return null
    }
    const history = parseHistory(await response.text())
    if (!history) warn('[desktop] update check: history was unreadable')
    return history
  } catch (err) {
    warn(`[desktop] update check failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
