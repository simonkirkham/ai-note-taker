// 48-A — impure model provisioning: download the whisper GGUF weights on first launch into
// app-data, verify sha256, and expose model-ready state. Built on the pure decision logic in
// models.ts (unit-tested). The whisper-cli BINARY is bundled in the installer (tiny, built
// per-platform in CI); only the large weights download here, so the installer stays ~82 MB.

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, readFile, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { missingModels, allPresent, type ModelManifest, type PresentModels, type ModelSpec } from './models'

// 48-A ships the live model (base.en). 48-B/C/D add medium.en / VAD / diarization specs here.
export const MANIFEST_48A: ModelManifest = {
  models: [
    {
      name: 'base.en',
      file: 'ggml-base.en.bin',
      sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
      bytes: 147964211,
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    },
  ],
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
  const present = await readPresent(dir, manifest)
  const todo = missingModels(manifest, present)
  if (todo.length === 0) {
    onProgress({ downloading: false, modelReady: true, progress: 1 })
    return
  }
  onProgress({ downloading: true, modelReady: false, progress: 0 })
  let done = 0
  for (const spec of todo) {
    await download(spec, dir)
    done += 1
    onProgress({ downloading: done < todo.length, modelReady: false, progress: done / todo.length })
  }
  onProgress({ downloading: false, modelReady: allPresent(manifest, await readPresent(dir, manifest)), progress: 1 })
}

// Resolve the bundled whisper-cli binary. Prod: under resources/whisper/; dev/test: WHISPER_BIN.
export function whisperBinPath(resourcesPath: string): string {
  if (process.env.WHISPER_BIN) return process.env.WHISPER_BIN
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  return path.join(resourcesPath, 'whisper', exe)
}
