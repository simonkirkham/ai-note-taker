# Phase 25-B — Paste / drop / pick images into notes

Inline images via Tiptap: optimistic insert → presigned S3 upload → persist a stable key; resolve keys → presigned GET on load. The headline lesson is an optimistic-upload ordering trap that only the deploy E2E caught.

## 1. Optimistic upload of a content-embedded blob: insert order is load-bearing

The note's persisted content is markdown; an image is `![](key)`. The editor must display *something* immediately (optimism) but persist only the **stable key**, never a transient `blob:`/presigned URL (which is dead on reload — data-rot).

Two guards are needed, and they interact:

| Guard | Prevents | Introduced by |
|---|---|---|
| `dropUnresolvedImages` on serialize — drop any image whose src isn't a stable key | **data-rot**: a `blob:` URL persisted into content | First fix (correct, but…) |
| **Presign-first**: presign → seed `src→key` map → *then* insert the node | **image loss**: a save during the upload window dropping the still-unmapped blob | Second fix (the real one) |

The trap: the first implementation inserted the blob node, *then* mapped it to its key only on upload **success**. A blur-save during the upload window (blur-to-save is the primary trigger; a real image PUT takes 1–3 s) serialized before the mapping existed → the drop-guard correctly dropped the unmapped blob → **no key persisted → the image silently vanished on reload**. Fix: presign first, seed the map, then insert — so content carries the key from the very first serialize. The drop-guard then becomes defense-in-depth rather than the primary mechanism.

Cost: the image appears after the presign round-trip rather than truly instantly. Correctness (never lose the image) wins. Residual edge: a PUT that fails *after* a save persisted the key, with the editor then unmounted before the catch runs, leaves a key with no object → broken image on reload (recoverable by re-upload; not data-rot).

## 2. Only the deploy E2E caught it — unit tests can't see this race

`noteImages.test.ts` (pure rewrite helpers) and MSW-mocked component tests all passed; the ordering bug lived in `NoteEditor.tsx` between `setImage` and the map seed, and surfaced only against the **deployed** app (the `NoteImageJourney` E2E timed out waiting for `/images/resolve` on reopen — no key was persisted). **Follow-up:** a `NoteEditor` component test (RTL + mocked presign/fetch) asserting "the node is not serialized with an unmapped src" would pin the invariant below the slow deploy gate. Tiptap-in-jsdom made it non-trivial, so it was deferred — recorded here so it isn't forgotten.

## 3. Gotchas

- **Tiptap v3 `StarterKit` does NOT bundle the `Image` node** (it did in v2). Add `@tiptap/extension-image`, pinned **exact** to the installed `@tiptap/core` version (`^` resolved to a newer minor and broke the peer dep).
- **`package-lock.json` must be regenerated under Node 20** (CI's version). The lock first committed (generated under Node 24) was missing the new package's `node_modules/` entry entirely — `npm ci` on CI would have failed with "Missing from lock file". `nvm use 20 && npm install --package-lock-only` reconciled it. Always check `node --version` before committing a lock change.

## 4. Process note — deploy flakiness this phase

Two recurring deploy-time issues cost many re-runs across 25-A/B/C: (a) the `TagsJourney.RemoveTag_PillDisappears` E2E flake (fixed upstream by BUG-17's tag-append concurrency retry), and (b) the `deploy-production` job **hanging at "Configure AWS credentials"** (~half of deploys), needing a cancel + re-run. Both are worth a technical-improvements ticket — the credential hang especially, as it silently stalls every deploy for ~30 min until noticed.
