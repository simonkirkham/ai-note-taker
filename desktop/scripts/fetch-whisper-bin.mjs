// 48-A — provision the whisper-cli binary + its DLLs into desktop/resources/whisper/ so the
// installer bundles them (the binary is tiny; only the GGUF model weights download at runtime).
// Runs at package time. Windows-only, matching Phase 31's platform scope — on other platforms it
// no-ops (local transcription simply isn't offered there). Uses the official whisper.cpp release.
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 'v1.9.1'
// sha256 of the pinned release asset — the binary ships inside the installer and runs on every
// machine, so it gets the same integrity bar as the model weights (verified before extraction).
const ASSET_SHA256 = { 'whisper-bin-x64.zip': '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539' }
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(desktopDir, 'resources', 'whisper')

const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const asset = process.platform === 'win32' ? (arch === 'arm64' ? null : 'whisper-bin-x64.zip') : null

if (process.platform !== 'win32') {
  console.log(`[fetch:whisper] platform ${process.platform} is not a local-transcription target — skipping (Windows-only).`)
  process.exit(0)
}
if (!asset) {
  console.log(`[fetch:whisper] no prebuilt whisper binary for win/${arch} — skipping; local mode unavailable on this arch.`)
  process.exit(0)
}

const url = `https://github.com/ggerganov/whisper.cpp/releases/download/${VERSION}/${asset}`
const tmpZip = path.join(desktopDir, '.whisper-bin.zip')
const tmpDir = path.join(desktopDir, '.whisper-bin')

console.log(`[fetch:whisper] downloading ${asset} (${VERSION})`)
rmSync(tmpZip, { force: true })
rmSync(tmpDir, { recursive: true, force: true })
execSync(`powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${tmpZip}'"`, { stdio: 'inherit' })

const expectedSha = ASSET_SHA256[asset]
const gotSha = createHash('sha256').update(readFileSync(tmpZip)).digest('hex')
if (gotSha !== expectedSha) {
  rmSync(tmpZip, { force: true })
  throw new Error(`[fetch:whisper] checksum mismatch for ${asset}: expected ${expectedSha}, got ${gotSha}`)
}

execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpDir}' -Force"`, { stdio: 'inherit' })

// The zip lays files under Release/ (whisper-cli.exe, whisper-server.exe + ggml*.dll + whisper.dll).
// Flatten into resources/whisper/ so the binaries find their DLLs as siblings at runtime.
const releaseDir = path.join(tmpDir, 'Release')
const src = existsSync(releaseDir) ? releaseDir : tmpDir
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const f of readdirSync(src)) {
  if (/\.(exe|dll)$/i.test(f)) cpSync(path.join(src, f), path.join(outDir, f))
}

// Both binaries are required and are NOT interchangeable: whisper-cli.exe runs the one-shot batch
// passes (48-B final, 48-C diarize); whisper-server.exe is the resident live path (BUG-53) and is
// the only one that accepts --host/--port. Shipping without the server is the BUG-56 failure — a
// silently empty live transcript — so fail packaging here rather than on a user's machine.
const REQUIRED_BINARIES = ['whisper-cli.exe', 'whisper-server.exe']
for (const required of REQUIRED_BINARIES) {
  if (!existsSync(path.join(outDir, required))) {
    throw new Error(`[fetch:whisper] ${required} not found after extraction`)
  }
}
rmSync(tmpZip, { force: true })
rmSync(tmpDir, { recursive: true, force: true })
console.log(`[fetch:whisper] staged ${REQUIRED_BINARIES.join(' + ')} + DLLs → ${outDir}`)
