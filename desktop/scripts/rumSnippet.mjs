// TI-98 — the monitoring (CloudWatch RUM) snippet for the desktop bundle.
// The website's deploy writes the snippet into its own index.html. The desktop build reads
// only the three ids out of it and rebuilds the snippet here, so nothing but this template
// can reach the installer — whatever else the live page carries.

const PLACEHOLDER = '<script id="rum-snippet"></script>'
const TAG = /<script id="rum-snippet">([^<]+)<\/script>/
const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const REGION = '[a-z]{2}-[a-z]+-\\d'
const MONITOR = new RegExp(`\\("cwr","(${GUID})","1\\.0\\.0","(${REGION})",`)
const POOL = new RegExp(`identityPoolId:"((${REGION}):${GUID})"`)
const FETCH_TIMEOUT_MS = 15_000

export function extractRumConfig(html) {
  const body = html.match(TAG)?.[1]
  const monitor = body?.match(MONITOR)
  const pool = body?.match(POOL)
  if (!monitor || !pool || pool[2] !== monitor[2]) return null
  return { monitorId: monitor[1], region: monitor[2], identityPoolId: pool[1] }
}

// Keep in step with the "Inject RUM snippet" steps in .github/workflows/deploy.yml.
export function buildRumSnippet({ monitorId, region, identityPoolId }) {
  return `<script id="rum-snippet">(function(n,i,v,r,s,c,u,x,z){`
    + `x=window.AwsRumClient={q:[],n:n,i:i,v:v,r:r,c:c,u:u};`
    + `window[n]=function(c,p){x.q.push({c:c,p:p});};`
    + `z=document.createElement("script");z.async=true;z.src=s;`
    + `document.head.insertBefore(z,document.getElementsByTagName("script")[0]);`
    + `})("cwr","${monitorId}","1.0.0","${region}",`
    + `"https://client.rum.us-east-1.amazonaws.com/3.x/cwr.js",`
    + `{sessionSampleRate:1,identityPoolId:"${identityPoolId}",`
    + `endpoint:"https://dataplane.rum.${region}.amazonaws.com",`
    + `telemetries:["errors","performance",["http",{addXRayTraceIdHeader:true}]],`
    + `allowCookies:true,enableXRay:true});</script>`
}

export function injectRumSnippet(html, snippet) {
  if (!html.includes(PLACEHOLDER)) throw new Error('rum-snippet placeholder not found in the built index.html')
  return html.replace(PLACEHOLDER, () => snippet)
}

// Returns the snippet, or null (after warning) when it cannot be had and is not required.
// Throws when required, so the published installer never ships without monitoring.
export async function resolveRumSnippet({ sourceUrl, required, fetchImpl = fetch, warn = console.warn }) {
  try {
    const res = await fetchImpl(sourceUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const config = extractRumConfig(await res.text())
    if (!config) throw new Error('no monitoring ids in the page')
    return buildRumSnippet(config)
  } catch (err) {
    const msg = `no monitoring snippet from ${sourceUrl}: ${err.message}`
    if (required) throw new Error(msg)
    warn(`[build:web] ${msg} — this build will report no faults`)
    return null
  }
}
