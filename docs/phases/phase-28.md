# Phase 28 — Resize images in a note

**Goal:** Let the user resize an inline image in a note — a **corner drag handle** for free, aspect-locked resizing plus a **preset control** (Small / Medium / Large / Original) that gives the keyboard-accessible path the jsx-a11y gate requires. The chosen size **persists** and round-trips on reload. This is **frontend-only**: images render solely through `NoteEditor` (Tiptap + `tiptap-markdown`) — there is no separate read-only image renderer, preview, or card image path — and the size lives **inside the existing note `content` markdown**, so there is **no new domain event, no backend, and no CDK change** (content is already event-sourced via `ContentEditedV2`). The one real subtlety is carrying a non-standard `width` attribute through the markdown round-trip and the existing key↔presigned-URL rewrite (`web/src/lib/noteImages.ts`) without it being silently dropped on save. Graduated from the "Resize images in a note" item in `future-features.md`.

## Summary

| Slice | Summary | Status | Depends on |
|-------|---------|--------|------------|
| 28-A | **Preset sizes + width persistence round-trip.** Add a `width` attribute to the image node; an accessible S/M/L/Original control on each image; carry `width` through `tiptap-markdown` serialize/parse and the `noteImages` key↔URL rewrite + drop-unresolved guard. Width survives save → reload → resolve. Optimistic by construction (local node attr). | Done | — |
| 28-B | **Drag-to-resize handle.** Corner drag handle on the image (hover/focus/selected, mirroring the existing ✕ remove control); aspect-locked; clamps to `[min, editor content width]`; reuses 28-A's width persistence (no new persistence code). | Done | 28-A |

> **28-A is the whole feature end-to-end** through the simplest, fully-accessible control, and carries all the risk — the width round-trip and the three `noteImages` regex helpers. **28-B is a pure UX enhancement** layered on 28-A's persisted `width` attribute: it adds the drag affordance and changes no save/load code. Ship 28-A first; 28-B only after the round-trip is proven.

**Decisions locked at scoping (2026-06-12):**
- **Interaction:** drag handle **and** preset fallback (user choice). The presets are not optional polish — a drag-only control trips the jsx-a11y gate (CHANGE-15 / 19-F3 precedent), so the keyboard-accessible preset path is a hard requirement, which is why it ships *first* in 28-A.
- **Frontend-only, no new event.** `width` is part of note content markdown, persisted by the existing `ContentEditedV2` event. No `event-model.md` / `event-schemas.md` / `view-schemas.md` change; no projection; the "rebuildable from events" rule is unaffected (content already round-trips).
- **No second render surface.** Confirmed the only place note images render is `NoteEditor` (via `resolveImages` in `api/notes.ts`) — Quick notes always uses the editor; there is no read-only markdown view, preview panel, or card that shows images. So 28-A touches one component plus the image lib, nothing else.
- **Persistence wire format — design decision deferred to Breaker/Pip plan mode** (does not change observable behaviour, so GWT stays format-agnostic). Two candidates, recommendation **(a)**:
  - **(a) Encode size in the markdown title slot** — `![alt](key "w=480")`. The existing `IMAGE_MARKDOWN` regex *already captures and preserves the title group byte-for-byte* through `rewriteImageSrcs`, so key↔URL swaps transport it for free; only `tiptap-markdown` serialize/parse for the image node need teaching. Smallest blast radius. Cost: overloads the title attribute semantically (note it in code).
  - **(b) Switch sized images to HTML `<img src width>`** — semantically clean, but every `noteImages` helper matches only `![]()`, so all three (`extractImageSrcs`, `rewriteImageSrcs`, `dropUnresolvedImages`) would need an HTML arm. Larger blast radius; reject unless (a) proves unworkable.
- **Preset widths:** fixed pixel widths (suggest S=240, M=480, L=720), each **capped at the image's natural width and the editor content width**; "Original" clears the `width` attribute entirely (renders at natural size). Confirm exact values during Stylist.

**Learning surface (secondary):** extending a third-party node (`@tiptap/extension-image`) with a custom attribute and a custom `tiptap-markdown` serialize/parse; keeping a content-embedded attribute honest across an existing rewrite pipeline whose invariant is "never persist a transient/expiring URL."

---

## Slices

### Slice 28-A — Preset sizes + width persistence round-trip

**User value:** Shrink an oversized screenshot or enlarge a small diagram with one click, and the size sticks when the note is reopened.

**Scenarios (GWT):**
- Given a note with an inline image at its natural size, when I choose "Small" from the image's size control, then the image immediately renders at the small preset width (optimistic — no wait for save).
- Given an image sized to "Medium", when I choose "Original", then the `width` attribute is cleared and the image renders at its natural size.
- Given I resized an image to "Large" and the note saved, when I reload the note, then the image still renders at "Large" (read-your-writes of the size).
- Given a saved note whose image has a `width`, when its stored key resolves to a presigned GET for display, then the width is preserved (the key↔URL swap does not drop it).
- Given an image still uploading (a `blob:`/preview src) for which a width was chosen, when a save fires before the upload completes, then the unresolved image is still dropped by `dropUnresolvedImages` (existing invariant holds) and no width is persisted for a dropped image.
- Given keyboard focus on an image, when I operate the size control via keyboard only, then I can change the size without a pointer.
- Given a malformed or absent width on load, when the note renders, then it falls back to natural size (never a broken/zero-size image).

**Acceptance criteria:**
- Extend `ImageWithRemove` (in `NoteEditor.tsx`) with a `width` attribute via `addAttributes()` (parse from + render to the DOM as a constrained `width`/`max-width` style or attribute).
- `tiptap-markdown` serialize/parse for the image node carries `width` per the chosen wire format (default recommendation: title-slot `"w=<px>"`); "Original" omits it.
- `web/src/lib/noteImages.ts` — `extractImageSrcs`/`extractImageKeys` still return the correct keys, `rewriteImageSrcs` preserves the width token across key↔URL swaps, and `dropUnresolvedImages` still drops unresolved images. Cover each with vitest, including a width round-trip and the never-persist-a-presigned-URL invariant with width present.
- An accessible size control on the image (rendered in `ImageNodeView.tsx`): reachable and operable by keyboard, labelled (S / M / L / Original), and not interfering with the existing ✕ remove control.
- **Optimistic UI** (mandatory): the size change is applied to the local node immediately; persistence rides the existing blur/leave save path (no new save mechanism).
- Each preset clamps to the image's natural width and the editor content width; "Original" clears `width`.
- Tests: vitest for the `noteImages` helpers (width round-trip; invariant) and `ImageNodeView` (size control present, keyboard-operable, sets/clears width); Browser.E2E — resize an image via a preset, reload, size persists. Run `npm run lint` on changed frontend files (set-state-in-effect / jsx-a11y gates).

### Slice 28-B — Drag-to-resize handle

**User value:** Fine-grained resizing by dragging the image corner, the familiar Notion/Docs feel, for when a preset isn't the right size.

**Scenarios (GWT):**
- Given an image in the editor, when I drag its corner handle inward, then the image shrinks following the pointer with aspect ratio preserved.
- Given I drag the corner outward, when the width would exceed the editor content width, then it clamps to the available width.
- Given I drag the corner inward past a sensible minimum, then the width clamps to that minimum (never collapses to zero).
- Given I release the drag, when the note saves, then the new width persists and round-trips on reload (reusing the 28-A path — no new save code).
- Given the image is neither hovered, focused, nor selected, then the drag handle is not shown (mirrors the existing ✕ remove control's reveal behaviour).
- Given I am dragging the handle, then normal text selection/caret behaviour in the editor is not triggered by the drag.

**Acceptance criteria:**
- Add a corner drag handle to `ImageNodeView.tsx`, revealed on hover/focus/selection only, visually consistent with the ✕ control and not overlapping it.
- Drag updates the node `width` attribute live, aspect-locked, clamped to `[min, editor content width]`; pointer-based (mouse). Touch support optional — note explicitly if deferred.
- Persistence is **entirely** via 28-A's `width` attribute path; this slice adds no serialize/parse or `noteImages` change.
- Drag must `preventDefault`/stop propagation so it does not start a text selection or blur the editor mid-drag.
- The keyboard-accessible preset control from 28-A remains the a11y path for resizing (drag is pointer-only by nature); the jsx-a11y gate is satisfied by 28-A's control, not the handle.
- Tests: vitest/component test for the clamp + aspect-ratio math (a pure helper computing next width from a drag delta is unit-tested in isolation); Browser.E2E — drag-resize an image, reload, size persists. Run `npm run lint` on changed files.

---

## Observability

Frontend-only, content-shaped change with **no server-side signal** — the feature writes a `width` token into note content markdown and reads it back; nothing new reaches the API or DynamoDB. Notes per the observability brief:

- **Primary silent failure mode — `width` dropped on save (round-trip regression).** This is the core risk (the `noteImages` regex or `tiptap-markdown` serializer omitting the attribute). It is **not independently observable in production telemetry** — a missing width just renders at natural size, which looks intentional. **Mitigation is the BDD/vitest round-trip specs in 28-A, not instrumentation;** the helper unit tests are the guard. No new metric/log is warranted (flagged, not added).
- **Observable failure mode — malformed width breaks image rendering.** If a bad wire format corrupts the `src`/key, image resolution (`resolveImages`) or the `<img>` load fails. This is **already covered** by the existing CloudWatch RUM JS-error + failed-request capture (Phase 25 / observability runbook) — no new instrumentation needed; just confirm the format keeps keys intact (28-A acceptance criteria).
- **No backend instrumentation gap** — the slice touches no Lambda/handler/DynamoDB code, so there is nothing new to log, trace, or alarm server-side.

## Deploy-time impact

**Neutral.** Frontend-only change — no CI workflow, CDK, alias/traffic-shifting, or build-step change; no resource added or update behaviour altered. No per-deploy cost delta.
