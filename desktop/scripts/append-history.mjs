// 53-A — grow the published update history by one entry. Run by publish-desktop.yml:
//   node desktop/scripts/append-history.mjs <previous-file> <out-file> <sha> <builtAt>
// A missing or unreadable previous file starts a fresh history rather than failing the publish.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const KEEP = 50

export function appendHistory(previousText, entry) {
  let previous = []
  try {
    const parsed = JSON.parse(previousText ?? '')
    if (Array.isArray(parsed)) previous = parsed
  } catch {
    // unreadable → start over
  }
  // A re-published commit keeps its first entry: a later build time would make every copy of
  // that commit count itself as behind, and updating could not clear it (same commit → skipped).
  if (previous.some((e) => e?.sha === entry.sha)) return previous.slice(-KEEP)
  return [...previous, entry].slice(-KEEP)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [previousFile, outFile, sha, builtAt] = process.argv.slice(2)
  if (!outFile || !sha || !builtAt) {
    console.error('usage: append-history.mjs <previous-file> <out-file> <sha> <builtAt>')
    process.exit(1)
  }
  const previousText = previousFile && existsSync(previousFile) ? readFileSync(previousFile, 'utf8') : null
  const next = appendHistory(previousText, { sha, builtAt })
  writeFileSync(outFile, JSON.stringify(next, null, 2) + '\n')
  console.log(`update history: ${next.length} entries, newest ${sha.slice(0, 7)} built ${builtAt}`)
}
