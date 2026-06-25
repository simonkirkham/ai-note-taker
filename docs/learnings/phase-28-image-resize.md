# Phase 28 — Resize images in a note (28-A presets + 28-B drag handle)

Frontend-only. `width` lives in note `content` markdown (persisted by `ContentEditedV2`) — no event, backend, projection, or CDK change. 28-A carries the risk (round-trip + persistence); 28-B is a pure UX layer on 28-A's `width` attribute.

## Headline lesson — an overlay control on an image breaks existing pointer journeys via tiny test images

28-B added a 14px corner drag handle. It caused **three failed deploys** before greening — none in authoring, all in the E2E gate.

| Fact | Detail |
|------|--------|
| Symptom | `NoteImageJourney.Remove_an_image...` timed out: *"image-resize-handle intercepts pointer events"* (deploy #548). |
| Cause | The handle is `opacity: 0` when hidden but **still hit-tests** — opacity does not disable pointer events. On the remove test's **1×1** image the 14px handle blankets the whole image, so it steals the `HoverAsync` Playwright aims at the image centre. |
| Failed fix | #261 added `pointer-events: none` when hidden / `auto` on hover-reveal. **Ineffective** — the hover the test performs is exactly what reveals the handle to `pointer-events: auto`, so it intercepts again. |
| Real fix | #264: the remove journey uploads a normal-sized image (`WidePngBytes`, 600×80), so the corner handle stays clear of the centre. Same reason the resize journey already used it. |

**Generalisable rules:**
1. **`opacity: 0` is not `pointer-events: none`** — a hidden overlay control still intercepts hit-tests. Always pair the two if the control overlays interactive content.
2. **A 1×1 test image is a trap for any corner/overlay affordance** — controls that anchor to image corners blanket a degenerate image and break unrelated hover/click journeys. Use a realistically-sized fixture (the file already had `WidePngBytes` for the resize clamp test for the same reason). Extend that convention to *every* image journey that hovers or clicks a control, not just the new one.
3. **The hard part of an overlay affordance is its interaction with existing pointer journeys, not its own behaviour** — 28-B's own drag/preset E2Es passed; the break was in a *pre-existing* remove test. Grep sibling journeys that hover/click the same element before adding an overlay.

## 28-A — width round-trip wire format

- **Title-slot encoding** `![alt](key "w=480")` rides the existing `IMAGE_MARKDOWN` regex's title capture **byte-for-byte** through `rewriteImageSrcs` — the key↔presigned-URL swap transports the width for free. Only `tiptap-markdown` serialize/parse needed teaching. Chosen over an HTML `<img width>` arm, which would have forced all three `noteImages` helpers to grow an HTML matcher.
- **Lesson:** to thread a custom attribute through an existing rewrite pipeline, overload a slot the pipeline **already preserves verbatim** — smallest blast radius.
- The round-trip is guarded by a real-extension markdown round-trip vitest, not a mock — the only honest guard against a serializer silently dropping the attribute (there is no production telemetry for "width dropped" — a missing width just renders natural size).

## 28-B — drag math reuse

- `nextWidthFromDrag(startWidth, deltaX, natural?, content?)` is a pure one-liner over 28-A's `clampWidth` — aspect-lock is implicit (width-only style; `height: auto`). Both the preset and drag paths share the same clamp.
- Handle is pointer-only (`aria-hidden`, not a tab stop); the keyboard a11y path is 28-A's preset control (jsx-a11y gate satisfied there). Window-level `mousemove`/`mouseup` so the drag survives leaving the small handle; `preventDefault` stops it starting a text selection.

## Process — merge-train contention

This phase ran against a **very active parallel session** (RYW-2/3, BUG-21, SnapStart all merging). Every main mutation triggers a ~deploy, serializing them; the recurring `TagsJourney` async-projection E2E flake (BUG-14/RYW-2/BUG-21 family) red-gated several Phase 28 deploys and greened on re-run each time. Holding merges to a green+idle window and `gh run rerun --failed` for the known flake were the right moves; the cost tail was deploy serialization, not the work.
