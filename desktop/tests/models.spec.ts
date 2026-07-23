import { test, expect } from '@playwright/test'
import { missingModels, allPresent, type ModelManifest } from '../src/models'

// 48-A — models (whisper binary + GGUF weights) download in the background on first launch
// into app-data, verified by sha256 before use. The "what still needs fetching" decision is
// pure so it unit-tests headlessly; the actual download/hash lives in main.ts.

const manifest: ModelManifest = {
  models: [
    { name: 'whisper-bin', file: 'whisper-cli.exe', sha256: 'aaa', bytes: 1000, url: 'https://x/w.exe' },
    { name: 'base.en', file: 'ggml-base.en.bin', sha256: 'bbb', bytes: 2000, url: 'https://x/b.bin' },
  ],
}

test('all models missing when nothing is present', () => {
  expect(missingModels(manifest, {}).map((m) => m.name)).toEqual(['whisper-bin', 'base.en'])
  expect(allPresent(manifest, {})).toBe(false)
})

test('a present, checksum-matching model is not re-downloaded', () => {
  const present = { 'whisper-cli.exe': { sha256: 'aaa' }, 'ggml-base.en.bin': { sha256: 'bbb' } }
  expect(missingModels(manifest, present)).toEqual([])
  expect(allPresent(manifest, present)).toBe(true)
})

test('a present-but-corrupt (wrong checksum) model is re-fetched', () => {
  const present = { 'whisper-cli.exe': { sha256: 'aaa' }, 'ggml-base.en.bin': { sha256: 'WRONG' } }
  expect(missingModels(manifest, present).map((m) => m.name)).toEqual(['base.en'])
  expect(allPresent(manifest, present)).toBe(false)
})

test('a partially-downloaded set reports only the absent files', () => {
  const present = { 'whisper-cli.exe': { sha256: 'aaa' } }
  expect(missingModels(manifest, present).map((m) => m.name)).toEqual(['base.en'])
})
