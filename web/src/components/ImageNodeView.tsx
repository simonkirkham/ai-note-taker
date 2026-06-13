import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import clsx from 'clsx';
import { useRef } from 'react';
import { presetWidth, type PresetSize } from '../lib/imageResize';
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

  // Apply the chosen preset, clamped to the image's natural width and the editor
  // content width; "Original" clears the width (renders at natural size). Optimistic —
  // the local node attribute changes immediately; the save rides the next blur/leave.
  const chooseSize = (size: PresetSize) => {
    const natural = imgRef.current?.naturalWidth ?? 0;
    const content = editor?.view.dom.clientWidth ?? 0;
    updateAttributes({ width: presetWidth(size, natural, content) });
  };

  // `alt` stays an empty string (decorative image); empty `title` omits the attribute.
  return (
    <NodeViewWrapper className={clsx(styles.wrapper, selected && styles.selected)}>
      {unresolved ? (
        <span
          className={styles.placeholder}
          data-testid="image-placeholder"
          role="img"
          aria-label="Loading image…"
        />
      ) : (
        <>
          <img
            ref={imgRef}
            className={styles.image}
            src={src}
            alt={alt ?? ''}
            title={title || undefined}
            style={width ? { width: `${width}px`, maxWidth: '100%' } : undefined}
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
