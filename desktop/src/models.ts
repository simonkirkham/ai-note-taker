// 48-A — local-model provisioning. Pure decision logic (what still needs fetching, given
// what is on disk) so it unit-tests headlessly; main.ts does the actual download + hashing
// on first launch, writing into app.getPath('userData')/models. Keeps the installer ~82 MB
// (models are fetched at runtime, not bundled — phase-48 decision).

// 48-B — a model's role. 'live' models gate local readiness (the small base.en, needed to
// record at all); 'final' models (the large medium.en) are best-effort — downloaded too, but
// local mode is usable before they arrive, and the stop-time final pass is simply skipped until
// they're present. Undefined role is treated as 'live' (48-A's single base.en).
export type ModelRole = 'live' | 'final'

export type ModelSpec = {
  name: string // logical id, e.g. 'base.en'
  file: string // filename on disk, e.g. 'ggml-base.en.bin'
  sha256: string // expected checksum
  bytes: number // expected size (readiness size-gate + progress)
  url: string // download source
  role?: ModelRole // default 'live'
}

export type ModelManifest = { models: ModelSpec[] }

// What is on disk now: filename → its computed sha256.
export type PresentModels = Record<string, { sha256: string }>

export function isLive(m: ModelSpec): boolean {
  return (m.role ?? 'live') === 'live'
}

// Models absent or checksum-mismatched (corrupt/partial) — these must be (re)downloaded.
// Live models come first so recording becomes possible before the large final model lands.
export function missingModels(manifest: ModelManifest, present: PresentModels): ModelSpec[] {
  const missing = manifest.models.filter((m) => present[m.file]?.sha256 !== m.sha256)
  return [...missing.filter(isLive), ...missing.filter((m) => !isLive(m))]
}

// True when the LIVE models are present — local mode is ready to record (the final model may
// still be downloading; the final pass degrades gracefully until it arrives).
export function liveReady(manifest: ModelManifest, present: PresentModels): boolean {
  return manifest.models.filter(isLive).every((m) => present[m.file]?.sha256 === m.sha256)
}

// True when EVERY model (live + final) is present — nothing left to download.
export function allPresent(manifest: ModelManifest, present: PresentModels): boolean {
  return missingModels(manifest, present).length === 0
}
