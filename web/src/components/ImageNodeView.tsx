import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import clsx from 'clsx';
import styles from './ImageNodeView.module.css';

// Renders an inline image with a hover/focus-revealed remove control. The
// control deletes the node from the document (no API call) — the S3 object is
// left in place and purged when the note is deleted (slice 25-C).
export default function ImageNodeView({ node, deleteNode, selected }: NodeViewProps) {
  const { src, alt, title } = node.attrs as { src?: string; alt?: string; title?: string };
  return (
    <NodeViewWrapper className={clsx(styles.wrapper, selected && styles.selected)}>
      <img className={styles.image} src={src ?? ''} alt={alt ?? ''} title={title || undefined} />
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
