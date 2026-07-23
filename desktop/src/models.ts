// 48-A — local-model provisioning. Pure decision logic (what still needs fetching, given
// what is on disk) so it unit-tests headlessly; main.ts does the actual download + hashing
// on first launch, writing into app.getPath('userData')/models. Keeps the installer ~82 MB
// (models are fetched at runtime, not bundled — phase-48 decision).

export type ModelSpec = {
  name: string // logical id, e.g. 'base.en'
  file: string // filename on disk, e.g. 'ggml-base.en.bin'
  sha256: string // expected checksum
  bytes: number // expected size (for progress reporting)
  url: string // download source
}

export type ModelManifest = { models: ModelSpec[] }

// What is on disk now: filename → its computed sha256.
export type PresentModels = Record<string, { sha256: string }>

// Models absent or checksum-mismatched (corrupt/partial) — these must be (re)downloaded.
export function missingModels(manifest: ModelManifest, present: PresentModels): ModelSpec[] {
  return manifest.models.filter((m) => present[m.file]?.sha256 !== m.sha256)
}

// True when every manifest model is present and checksum-valid → local mode is ready.
export function allPresent(manifest: ModelManifest, present: PresentModels): boolean {
  return missingModels(manifest, present).length === 0
}
