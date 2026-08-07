import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import clsx from 'clsx';
import { useRef, useState } from 'react';
import { nextWidthFromDrag, presetWidth, type PresetSize } from '../lib/imageResize';
import { isImageKey } from '../lib/noteImages';
import styles from './ImageNodeView.module.css';

// Compact labels; the accessible name (aria-label) stays the full word so the
// control reads clearly to assistive tech and is the keyboard-accessible resize
// path the jsx-a11y gate requires (the 28-B drag handle is pointer-only).
const SIZE_OPTIONS: { size: PresetSize; short: string }[] = [
  { size: 'Small', short: 'S' },
  { size: 'Medium', short: 'M' },
  { size: 'Large', short: 'L' },
  { size: 'Original', short: '⤢' },
];

// Shown in place of a failed image that carries no alt text of its own.
const MISSING_IMAGE_LABEL = 'Image unavailable';

// Renders an inline image with a hover/focus-revealed remove control and a size
// control. The controls mutate the document (no API call) — persistence rides the
// existing blur-save path. The S3 object is left in place and purged on note delete.
export default function ImageNodeView({
  node,
  deleteNode,
  updateAttributes,
  editor,
  selected,
}: NodeViewProps) {
  const { src, alt, title, width } = node.attrs as {
    src?: string;
    alt?: string;
    title?: string;
    width?: number | null;
  };
  const imgRef = useRef<HTMLImageElement>(null);

  // Before resolveImages swaps the stored S3 key for a presigned URL, `src` is the
  // bare key (e.g. `notes/{id}/{img}.png`). Rendering that as an <img> fetches it as
  // a URL relative to the SPA route → `…/notes/notes/…` → 403 (BUG-19). Show a
  // placeholder until the key resolves to a loadable URL.
  const unresolved = !src || isImageKey(src);

  // CHANGE-31: a src that resolves but 404s/expires would otherwise render the browser's
  // broken-image glyph, which says nothing about what the picture was. Track the src that
  // failed (not a bare boolean) and DERIVE the failed flag from it, so a later src — a
  // re-resolved presigned URL, or a different image in the same node position — retries
  // automatically without a setState-in-effect reset (the lint rule bans that).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = !!src && failedSrc === src;
  const fallbackText = alt?.trim() || MISSING_IMAGE_LABEL;

  // The three render states are mutually exclusive: still resolving, failed to load, loaded.
  const showFallback = !unresolved && failed;
  const showImage = !unresolved && !failed;

  // Apply the chosen preset, clamped to the image's natural width and the editor
  // content width; "Original" clears the width (renders at natural size). Optimistic —
  // the local node attribute changes immediately; the save rides the next blur/leave.
  const chooseSize = (size: PresetSize) => {
    const natural = imgRef.current?.naturalWidth ?? 0;
    const content = editor?.view.dom.clientWidth ?? 0;
    updateAttributes({ width: presetWidth(size, natural, content) });
  };

  // Corner drag-resize. Pointer-only (the preset control above is the keyboard a11y
  // path); aspect-locked because only `width` is set. Updates the local node width
  // live during the drag — persistence rides the same blur-save path as the presets.
  // Listeners go on `window` so the drag continues even if the pointer leaves the
  // small handle; preventDefault stops the drag starting a text selection / blur.
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = width ?? Math.round(imgRef.current?.getBoundingClientRect().width ?? 0);
    const onMove = (move: MouseEvent) => {
      const natural = imgRef.current?.naturalWidth ?? 0;
      const content = editor?.view.dom.clientWidth ?? 0;
      updateAttributes({ width: nextWidthFromDrag(startWidth, move.clientX - startX, natural, content) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // `alt` stays an empty string (decorative image); empty `title` omits the attribute.
  return (
    <NodeViewWrapper className={clsx(styles.wrapper, selected && styles.selected)}>
      {unresolved && (
        <span
          className={styles.placeholder}
          data-testid="image-placeholder"
          role="img"
          aria-label="Loading image…"
        />
      )}
      {/* The image could not be fetched: show what it was (its alt text) as visible,
          muted placeholder text rather than the browser's broken-image glyph. The size
          and drag controls are omitted — there is no rendered image to resize — but the
          remove control below stays, so a dead image can still be taken out of the note. */}
      {showFallback && (
        <span className={styles.fallback} data-testid="image-fallback">
          {fallbackText}
        </span>
      )}
      {showImage && (
        <>
          <img
            ref={imgRef}
            className={styles.image}
            src={src}
            alt={alt ?? ''}
            title={title || undefined}
            style={width ? { width: `${width}px`, maxWidth: '100%' } : undefined}
            onError={() => setFailedSrc(src ?? null)}
          />
          <div className={styles.sizeControl} role="group" aria-label="Image size">
            {SIZE_OPTIONS.map(({ size, short }) => (
              <button
                key={size}
                type="button"
                className={styles.sizeButton}
                data-testid={`image-size-${size.toLowerCase()}`}
                aria-label={size}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseSize(size)}
              >
                {short}
              </button>
            ))}
          </div>
          <span
            className={styles.resizeHandle}
            data-testid="image-resize-handle"
            aria-hidden="true"
            onMouseDown={startDrag}
          />
        </>
      )}
      <button
        type="button"
        className={styles.removeButton}
        data-testid="remove-image-button"
        aria-label="Remove image"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => deleteNode()}
      >
        ✕
      </button>
    </NodeViewWrapper>
  );
}
