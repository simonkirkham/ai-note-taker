// TI-98 — the monitoring (CloudWatch RUM) snippet for the desktop bundle.
// The website's deploy writes the snippet into its own index.html; the desktop build copies it
// from there, so both report to the same monitor with no AWS credentials in the desktop build.

const PLACEHOLDER = '<script id="rum-snippet"></script>'
const POPULATED = /<script id="rum-snippet">[^<]+<\/script>/

export function extractRumSnippet(html) {
  const match = html.match(POPULATED)
  return match ? match[0] : null
}

export function injectRumSnippet(html, snippet) {
  if (!html.includes(PLACEHOLDER)) throw new Error('rum-snippet placeholder not found in the built index.html')
  return html.replace(PLACEHOLDER, () => snippet)
}
