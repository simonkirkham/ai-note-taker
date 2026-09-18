// CHANGE-43 — the build stamp links to the pipeline run that produced the app. The shell denies
// new windows, so the link would do nothing; the main process opens it in the system browser
// instead. Narrow on purpose: only this repository's own pages over https, never anything a page
// could point at. Pure, so it is unit-tested headlessly.
const REPO_PREFIX = '/simonkirkham/ai-note-taker/'

export function shouldOpenExternally(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.host !== 'github.com') return false
  return `${parsed.pathname}/`.startsWith(REPO_PREFIX)
}
