// 48-A — impure model provisioning: download the whisper GGUF weights on first launch into
// app-data, verify sha256, and expose model-ready state. Built on the pure decision logic in
// models.ts (unit-tested). The whisper-cli BINARY is bundled in the installer (tiny, built
// per-platform in CI); only the large weights download here, so the installer stays ~82 MB.

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, readFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { missingModels, allPresent, liveReady, type ModelManifest, type PresentModels, type ModelSpec } from './models'

// Model set for local transcription. base.en drives the live transcript (role 'live' → gates
// readiness); small.en drives the higher-quality stop-time final/diarization pass (role 'final' →
// best-effort, downloaded too but local mode is usable before it lands). 48-C adds the VAD spec.
// NOTE (Hawk 48-A): bytes is load-bearing for the launch size-gate — keep bytes + sha256 paired to
// the true file whenever a model is added/changed, or the size-gate loops on re-download.
export const MANIFEST: ModelManifest = {
  models: [
    {
      name: 'base.en',
      file: 'ggml-base.en.bin',
      sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
      bytes: 147964211,
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
      role: 'live',
    },
    {
      // BUG-52: small.en (not medium.en) for the stop-time final/diarization pass — medium.en was
      // minutes of full CPU on a laptop (doubled for 1:1 diarization). small.en is ~2.3x realtime
      // and ~466 MB: much lighter, still clearly better than the base.en live model.
      name: 'small.en',
      file: 'ggml-small.en.bin',
      sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
      bytes: 487614201,
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
      role: 'final',
    },
    {
      name: 'silero-vad',
      file: 'ggml-silero-v5.1.2.bin',
      sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
      bytes: 885098,
      url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
      role: 'vad',
    },
  ],
}

// The higher-quality model the stop-time final pass uses (small.en), or '' if not present yet.
export function finalModelFile(): string {
  const spec = MANIFEST.models.find((m) => m.role === 'final')
  return spec ? spec.file : ''
}

// The VAD model for 48-C source-separation diarization, or '' if none configured.
export function vadModelFile(): string {
  const spec = MANIFEST.models.find((m) => m.role === 'vad')
  return spec ? spec.file : ''
}

export function modelsDir(userDataDir: string): string {
  return path.join(userDataDir, 'models')
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(file))
  return hash.digest('hex')
}

// Compute what is present on disk, for missingModels(). Gates on file SIZE, not a full re-hash:
// the sha256 is verified once at download time (below), and re-hashing a 1.5 GB model on every
// launch would stall startup. A size match is treated as the (already-verified) expected hash; a
// truly corrupt same-size file is the accepted tradeoff for fast launches.
async function readPresent(dir: string, manifest: ModelManifest): Promise<PresentModels> {
  const present: PresentModels = {}
  for (const m of manifest.models) {
    const file = path.join(dir, m.file)
    try {
      const st = await stat(file)
      if (st.size === m.bytes) present[m.file] = { sha256: m.sha256 }
    } catch {
      /* absent */
    }
  }
  return present
}

async function download(spec: ModelSpec, dir: string): Promise<void> {
  const dest = path.join(dir, spec.file)
  const tmp = `${dest}.part`
  const res = await fetch(spec.url)
  if (!res.ok || !res.body) throw new Error(`download ${spec.name} failed: HTTP ${res.status}`)
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp)
    Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream).pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
  })
  const got = await sha256File(tmp)
  if (got !== spec.sha256) {
    await rm(tmp, { force: true }) // don't leave a large corrupt .part lingering
    throw new Error(`checksum mismatch for ${spec.name}: expected ${spec.sha256}, got ${got}`)
  }
  await rename(tmp, dest) // atomic: a half-written file never looks "present"
}

export type ProgressCb = (state: { downloading: boolean; modelReady: boolean; progress: number }) => void

// Ensure every manifest model is present+valid, downloading the missing ones sequentially.
// Reports coarse progress (fraction of models done). Safe to call once on launch.
export async function ensureModels(
  userDataDir: string,
  manifest: ModelManifest,
  onProgress: ProgressCb,
): Promise<void> {
  const dir = modelsDir(userDataDir)
  await mkdir(dir, { recursive: true })
  let present = await readPresent(dir, manifest)
  const todo = missingModels(manifest, present) // live-first order
  if (todo.length === 0) {
    onProgress({ downloading: false, modelReady: true, progress: 1 })
    return
  }
  onProgress({ downloading: true, modelReady: liveReady(manifest, present), progress: 0 })
  let done = 0
  for (const spec of todo) {
    await download(spec, dir)
    done += 1
    // Re-read presence so modelReady flips true as soon as the LIVE model(s) land — recording
    // becomes possible before the large final (small.en) model finishes downloading.
    present = await readPresent(dir, manifest)
    onProgress({ downloading: done < todo.length, modelReady: liveReady(manifest, present), progress: done / todo.length })
  }
  onProgress({ downloading: false, modelReady: allPresent(manifest, present), progress: 1 })
}

// Resolve the bundled whisper-cli binary — the ONE-SHOT batch passes (48-B final, 48-C diarize).
// Prod: under resources/whisper/; dev/test: WHISPER_BIN.
export function whisperBinPath(resourcesPath: string): string {
  if (process.env.WHISPER_BIN) return process.env.WHISPER_BIN
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  return path.join(resourcesPath, 'whisper', exe)
}

// BUG-56 — resolve the bundled whisper-server binary, the RESIDENT live path (BUG-53). A separate
// binary from the CLI, shipped in the same bundle: it takes --host/--port and serves /inference,
// which whisper-cli rejects outright (it exits on the unknown argument). BUG-53 passed the CLI path
// here, so the resident server never started and the live transcript was silently empty. Keep the
// two overrides distinct — WHISPER_BIN must not redirect the server.
export function whisperServerBinPath(resourcesPath: string): string {
  if (process.env.WHISPER_SERVER_BIN) return process.env.WHISPER_SERVER_BIN
  const exe = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'
  return path.join(resourcesPath, 'whisper', exe)
}
