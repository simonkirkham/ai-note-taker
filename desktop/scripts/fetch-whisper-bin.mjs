// 48-A — provision the whisper-cli binary + its DLLs into desktop/resources/whisper/ so the
// installer bundles them (the binary is tiny; only the GGUF model weights download at runtime).
// Runs at package time. Windows-only, matching Phase 31's platform scope — on other platforms it
// no-ops (local transcription simply isn't offered there). Uses the official whisper.cpp release.
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 'v1.9.1'
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
execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpDir}' -Force"`, { stdio: 'inherit' })

// The zip lays files under Release/ (whisper-cli.exe + ggml*.dll + whisper.dll). Flatten into
// resources/whisper/ so whisper-cli.exe finds its DLLs as siblings at runtime.
const releaseDir = path.join(tmpDir, 'Release')
const src = existsSync(releaseDir) ? releaseDir : tmpDir
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const f of readdirSync(src)) {
  if (/\.(exe|dll)$/i.test(f)) cpSync(path.join(src, f), path.join(outDir, f))
}

if (!existsSync(path.join(outDir, 'whisper-cli.exe'))) {
  throw new Error('[fetch:whisper] whisper-cli.exe not found after extraction')
}
rmSync(tmpZip, { force: true })
rmSync(tmpDir, { recursive: true, force: true })
console.log(`[fetch:whisper] staged whisper-cli.exe + DLLs → ${outDir}`)
