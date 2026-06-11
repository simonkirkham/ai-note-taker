import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import clsx from 'clsx';
import { isImageKey } from '../lib/noteImages';
import styles from './ImageNodeView.module.css';

// Renders an inline image with a hover/focus-revealed remove control. The
// control deletes the node from the document (no API call) — the S3 object is
// left in place and purged when the note is deleted (slice 25-C).
export default function ImageNodeView({ node, deleteNode, selected }: NodeViewProps) {
  const { src, alt, title } = node.attrs as { src?: string; alt?: string; title?: string };
  // Before resolveImages swaps the stored S3 key for a presigned URL, `src` is the
  // bare key (e.g. `notes/{id}/{img}.png`). Rendering that as an <img> fetches it as
  // a URL relative to the SPA route → `…/notes/notes/…` → 403 (BUG-19). Show a
  // placeholder until the key resolves to a loadable URL.
  const unresolved = !src || isImageKey(src);
  // `alt` stays an empty string (decorative image); empty `title` omits the attribute.
  return (
    <NodeViewWrapper className={clsx(styles.wrapper, selected && styles.selected)}>
      {unresolved ? (
        <span className={styles.placeholder} data-testid="image-placeholder" role="img" aria-label="Loading image…" />
      ) : (
        <img className={styles.image} src={src} alt={alt ?? ''} title={title || undefined} />
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
