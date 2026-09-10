// CHANGE-41 — which build of the app is running, readable from the app itself.
//
// The number is the deploy's run number, the same `#N` the deploy history uses, injected
// at build time by both frontend build steps in deploy.yml and by the desktop installer
// build. Off a deploy (local `npm run dev`, a hand build) it is absent and "dev" is the
// honest answer.
//
// Read inside the functions rather than into a module-level const: GitHub passes an unset
// value as "" (not undefined), and the specs stub the value per case.

const NOT_A_DEPLOY = 'dev'

export function buildLabel(): string {
  const number = (import.meta.env.VITE_BUILD_NUMBER ?? '').trim()
  return `Build ${number || NOT_A_DEPLOY}`
}

export function buildTitle(): string | undefined {
  const sha = (import.meta.env.VITE_BUILD_SHA ?? '').trim()
  return sha ? `${buildLabel()} — commit ${sha.slice(0, 7)}` : undefined
}
