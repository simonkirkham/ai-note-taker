// CHANGE-41 — which build of the app is running, readable from the app itself.
//
// The number is the deploy's run number, the same `#N` the deploy history uses, injected
// at build time by both frontend build steps in deploy.yml and by the desktop installer
// build. Off a deploy (local `npm run dev`, a hand build) it is absent and "dev" is the
// honest answer.
//
// CHANGE-43 — the stamp also links to the pipeline run that produced it, so tracing a running
// copy back to its run is a click rather than a search through the release history.
//
// Read inside the functions rather than into a module-level const: GitHub passes an unset
// value as "" (not undefined), and the specs stub the value per case.

const NOT_A_DEPLOY = 'dev'
const RUNS_BASE = 'https://github.com/simonkirkham/ai-note-taker/actions/runs'

// One reader per variable, each a LITERAL `import.meta.env.X` access: that exact form is what the
// bundler substitutes at build time. A lookup by variable key happens to work here but depends on
// the whole env object being inlined, which is not the documented contract.
const clean = (value: string | undefined) => (value ?? '').trim()

const buildNumber = () => clean(import.meta.env.VITE_BUILD_NUMBER)
const buildSha = () => clean(import.meta.env.VITE_BUILD_SHA)
const buildRunId = () => clean(import.meta.env.VITE_BUILD_RUN_ID)
const installerVersion = () => clean(import.meta.env.VITE_BUILD_INSTALLER_VERSION)

export function buildLabel(): string {
  return `Build ${buildNumber() || NOT_A_DEPLOY}`
}

// The run that built this copy. Digits only — the value is interpolated into a URL, and a build
// arg is not a place to trust input blindly.
export function buildRunUrl(): string | undefined {
  const runId = buildRunId()
  return /^\d+$/.test(runId) ? `${RUNS_BASE}/${runId}` : undefined
}

export function buildTitle(): string | undefined {
  const parts: string[] = []
  const number = buildNumber()
  if (number) parts.push(`Release ${number}`)

  // Only a packaged desktop build carries an installer version (e.g. 1.0.0-20260916.226).
  const installer = installerVersion()
  if (installer) parts.push(`installer ${installer}`)

  const sha = buildSha()
  if (sha) parts.push(`commit ${sha.slice(0, 7)}`)

  if (parts.length === 0) return undefined
  // Name what actually opens. The link is the RELEASE's run; the installer version above it is
  // numbered by a separate packaging run, so "this run" would point at the wrong one.
  return buildRunUrl() ? `${parts.join(' · ')} — click to open this release` : parts.join(' · ')
}

// 53-A — when this build was made, as the ISO timestamp the publish workflow also writes to the
// update history. Empty off a published desktop build, which turns the update notice off.
export function buildTime(): string {
  return clean(import.meta.env.VITE_BUILD_TIME)
}
