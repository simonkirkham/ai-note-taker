# Phase 25 — Inline images in notes (paste, drop, pick)

**Goal:** Let the user add images to a note — **clipboard paste, drag-and-drop, or a file-picker button** — and see them **rendered inline** in the note body, primarily while a meeting is **live** (the "Quick notes" tab) but identically when editing any note afterwards. Images are stored as **binary objects in a private S3 bucket** (the project's first user-data blob store); the note **content** holds only a stable reference, and the browser fetches each image via a short-lived **presigned GET** minted at render time. This is reuse-heavy on the frontend — content is already markdown rendered by Tiptap, whose `StarterKit` already bundles an `Image` extension — so the net-new work is the backend media path (bucket + presigned upload/download + access control + IAM + CORS) and the editor's upload/render wiring. Graduated from the "Paste images into a note during a live meeting" item in `future-features.md`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 25-A | **Backend media store + presigned upload/download.** Private S3 bucket (block-public-access, RETAIN, CORS for the app origin); `POST /notes/{id}/images:presign-upload` (server-enforced content-type allowlist + max-size) and `POST /notes/{id}/images:resolve` (batch presigned GET). Both authorize by note ownership + key prefix. | Done | — |
| 25-B | **Paste / drop / pick → upload → inline render (frontend, live + edit).** Tiptap paste+drop handlers and a toolbar file-picker; optimistic local preview while the upload runs; persist a **stable key reference** in content; on load resolve refs → presigned GET and swap into image `src`; on save swap presigned URLs **back** to keys so an expiring URL is never written. | Done | 25-A |
| 25-C | **Lifecycle + analysis hygiene.** Deleting a note purges its `notes/{id}/` image prefix from S3; image markdown is stripped from the text sent to the AI analysis model (images are stored/displayed, never analysed this phase). | Done | 25-A |

> **25-A is the foundation** — no user-visible change alone, but everything else needs the bucket + presign endpoints. **25-B is the whole user-facing feature** and the only slice with real subtlety (the key↔presigned-URL rewrite on load/save). **25-C** prevents two silent rots: orphaned blobs after a note delete, and image syntax polluting the analysis prompt. 25-B and 25-C both depend only on 25-A and can run in parallel.

**Decisions locked at scoping (2026-06-10):**
- **Inline**, not a separate attachment model — Tiptap's built-in `Image` extension renders `![](url)` for free, so inline is *less* work than a bespoke attachment list (this reversed the future-features "default to attachment if inline is hard" steer).
- **Capture surfaces:** clipboard paste · drag-and-drop · file-picker button. **Mobile camera is out of scope.**
- **Access model:** private bucket, **presigned GET resolved at render time**. Content stores an S3 key, never a permanent or presigned URL.
- **No new domain event.** The image *reference* lives in note content (already event-sourced via `ContentEditedV2`); the image *bytes* are deliberately external blob state in S3. Object ownership is enforced by namespacing keys under `notes/{noteId}/` and checking note ownership — so no new projection is needed and the "rebuildable from events" rule is unaffected for content. (A `NoteImageAttached` event was considered and rejected for simplicity; revisit only if a per-note image index is later needed for something content-scanning can't serve.)
- **Defaults:** content-type allowlist `image/png, image/jpeg, image/gif, image/webp`; max size **10 MB** per image. Both enforced **server-side** in the presigned-upload policy, not just client-side.

**Learning surface (secondary):** first binary-blob path in an otherwise text/event-sourced app; browser-direct-to-S3 uploads via a presigned POST policy (size/type conditions, bucket CORS) vs proxying bytes through Lambda; minting short-lived presigned GETs at render time and the data-rot trap of persisting an expiring URL; keeping external blob state honest alongside an event-sourced aggregate.

---

## Slices

### Slice 25-A — Backend media store + presigned upload/download

**User value:** None directly — the storage + access foundation the editor needs.

**Scenarios (GWT):**
- Given I own note N, when I `POST /notes/N/images:presign-upload` with a permitted content-type, then I get a presigned upload target + a stable image key under `notes/N/`.
- Given a content-type outside the allowlist (e.g. `application/pdf`), when I request a presigned upload, then it is rejected (`400`).
- Given the presigned upload policy, when a client tries to upload over the **10 MB** cap, then S3 rejects the upload (size enforced in the policy, not just client-side).
- Given I do **not** own note N, when I request a presigned upload or resolve for N, then it is rejected (`403`/`404`, consistent with existing note authz).
- Given keys `notes/N/img1`, `notes/N/img2`, when I `POST /notes/N/images:resolve` with those keys, then I get a presigned GET URL for each.
- Given a key whose prefix is **not** `notes/N/`, when I include it in a resolve for note N, then that key is rejected (no cross-note URL minting).

**Acceptance criteria:**
- CDK: new private S3 bucket — block-all-public-access, `RemovalPolicy.Retain`, server-side encryption, abort-incomplete-multipart lifecycle rule, and **CORS** allowing the CloudFront app origin for `PUT`/`POST`/`GET`. IAM: the API Lambda gets `s3:PutObject`/`GetObject`/`DeleteObject` + presign scoped to this bucket's ARN only.
- API handlers (HTTP-only; orchestration in a handler per the command-handler convention): `presign-upload` returns `{ imageId, key, upload }`; `resolve` returns presigned GETs for an array of keys. Bucket name injected via env var (guard with `string.IsNullOrEmpty`).
- Server-side enforcement of the content-type allowlist and 10 MB cap via the presigned **POST policy** conditions (`content-length-range`, `Content-Type` starts-with), so the client cannot exceed them.
- Ownership: both endpoints verify the caller owns the note **and** every key is under that note's `notes/{noteId}/` prefix before issuing any URL.
- Tests: Api.Integration — issues upload target for owner; rejects disallowed content-type; rejects non-owner; resolve mints GETs for in-prefix keys and rejects out-of-prefix keys. Infrastructure.Assertions — bucket blocks public access, has RETAIN + CORS, IAM is scoped to the one bucket ARN (no `*`).

### Slice 25-B — Paste / drop / pick → upload → inline render (frontend, live + edit)

**User value:** Paste a screenshot of a shared slide mid-meeting (or drag/pick a file) and it appears in the note immediately, and is still there on reload.

**Scenarios (GWT):**
- Given a live meeting on the "Quick notes" tab, when I paste an image from the clipboard, then it appears inline in the editor immediately (optimistic local preview) while it uploads in the background.
- Given I drag an image file onto the editor, then it is inserted inline the same way; given I click the file-picker button and choose an image, likewise.
- Given the upload to S3 succeeds, when I blur/save, then the note content persists a **stable key reference** (not a presigned or temporary URL) and the local preview is reconciled to the stored image.
- Given I reload the note later, when it renders, then each image reference is resolved to a fresh presigned GET and displays correctly (no broken image).
- Given the note is saved, when I inspect the persisted content, then it contains **no presigned/expiring URL** — only stable keys (guards against data rot).
- Given an upload fails (network/policy reject), then the optimistic image is removed and the user is told it didn't attach (the note is never silently saved with a dead image).
- Given a non-image paste (text), then existing paste behaviour is unchanged.

**Acceptance criteria:**
- Enable/configure the Tiptap `Image` node; add `handlePaste` + `handleDrop` for image blobs and a toolbar file-picker button — wired in `NoteEditor.tsx` so it works in the live "Quick notes" tab and ordinary note editing (same component).
- Upload flow: on image add → request presigned upload (25-A) → upload bytes directly to S3 → set the image node `src` to the **stable key reference**.
- Render flow: on note load, extract image refs from content, call `:resolve` (batched), and swap each presigned GET into the corresponding node `src`; on `getMarkdown()`/save, swap presigned URLs **back** to stable keys. A pure `src`-rewrite helper (key↔presigned, both directions) is unit-tested in isolation, including the invariant **"never serialize a presigned URL into content."**
- **Optimistic UI** (mandatory per project convention): the image shows instantly via a local object URL; on success it reconciles to the stored ref; on failure it is removed with a visible error. Mirror the optimistic pattern of the nearest existing mutation in `NoteView`/`NoteEditor`.
- Client-side pre-checks (type + size) for fast feedback, but server policy (25-A) is the source of truth.
- Tests: vitest for the `src`-rewrite helper (round-trip; never-persist-presigned invariant; multiple images); Browser.E2E — paste an image, see it inline, reload the note, image still renders. Run `npm run lint` on changed files (set-state-in-effect rule).

### Slice 25-C — Lifecycle + analysis hygiene

**User value:** No orphaned blobs piling up after deletes; the AI analysis isn't confused by image markdown.

**Scenarios (GWT):**
- Given a note with images, when the note is deleted, then its `notes/{id}/` S3 prefix is purged (no orphaned objects left behind).
- Given a note whose content contains inline image markdown, when AI analysis runs, then the text sent to the model has image syntax stripped (images are not described/analysed this phase).
- Given analysis output, then it is unchanged in shape — only the model *input* had image markdown removed.

**Acceptance criteria:**
- In the `NoteDeleted` handling path, after events are persisted, purge the note's S3 image prefix via a media helper (S3-only side effect; does not touch the event store).
- The analysis input-prep step strips markdown image syntax (`![...](...)`) from content before the prompt is built; transcript-based analysis is unaffected.
- **Deferred (documented, not built):** cleanup of an image removed from content *while a note still exists* (mid-edit orphan). Left as a known minor cost; a periodic prefix-vs-content reconcile sweep is the future option if it matters.
- Tests: deleting a note purges its prefix (Api.Integration with an S3 double / LocalStack-style fake, or a unit test on the media helper); analysis input-prep strips image markdown (unit test).

---

## Observability

| Risk | Symptom | What to make visible |
|---|---|---|
| A presigned (expiring) URL gets persisted into content | Images render at first but 404 silently days later, after the URL expires | The never-persist-presigned unit invariant (25-B) is the primary guard; add a save-time assertion/log if a presigned host is detected in outgoing content. |
| Upload silently fails but the note saves with a dead reference | User believes the image attached; reload shows a broken image | Explicit failure path removes the node + user-visible error (25-B); log upload failures with note id + key. |
| `:resolve` returns a broken/expired URL or denies a legitimate key | Broken images on an otherwise valid note | Log resolve failures (key, note, reason); E2E reload-renders test (25-B). |
| Cross-note key minting (authz hole) | A user obtains a presigned URL for another note's image | Prefix + ownership check with a test (25-A); log/deny out-of-prefix keys. |
| Orphaned S3 objects accumulate | Slow, invisible storage-cost creep | Delete-note prefix purge (25-C); the mid-edit orphan gap is explicitly deferred and recorded, not silently ignored. |
| Image markdown leaks into the analysis prompt | Degraded/confused AI analysis, wasted tokens | Strip-on-input (25-C) with a unit test. |

---

## Constraints

- **No new domain event, no new projection, no event-model change.** Image references ride in `ContentEditedV2`; bytes are external blob state in S3.
- **Browser uploads directly to S3** (presigned POST), not through Lambda — keep blob bytes off the API path. This requires bucket **CORS** for the app origin (25-A).
- **Server-side, not client-side, is authoritative** for the content-type allowlist and the 10 MB cap.
- **Mobile camera capture is out of scope** this phase.
- **AI analysis of image content is out of scope** — captured separately in `future-features.md` if revisited (would need a vision-capable model).
- New S3 bucket is `RemovalPolicy.Retain` (user data) and **block-public-access** — never public-read.
