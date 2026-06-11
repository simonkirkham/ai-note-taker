import Image from '@tiptap/extension-image';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from 'tiptap-markdown';
import { presignUpload, resolveImages } from '../api/notes';
import { dropUnresolvedImages, extractImageKeys, srcsToKeys } from '../lib/noteImages';
import styles from './NoteEditor.module.css';
import { useToast } from './toastContext';

interface NoteEditorProps {
  noteId: string;
  value: string;
  onChange: (md: string) => void;
  onBlur: () => void;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export default function NoteEditor({ noteId, value, onChange, onBlur }: NoteEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [buttonY, setButtonY] = useState<number | null>(null);
  const { showError } = useToast();

  // The ProseMirror paste/drop handlers reach the upload logic through this ref.
  // Calling the helpers directly from the useEditor config would make the config
  // depend on `editor` (the useEditor return), a circular type/initialiser cycle.
  const dataTransferHandlerRef = useRef<(data: DataTransfer | null) => boolean>(() => false);

  // Maps every transient display src (object URL while uploading, presigned URL
  // after a resolve) back to its stable S3 key. Serialization runs each value
  // through this so persisted markdown only ever contains keys, never an
  // expiring URL. A ref, not state: it changes outside React's render cycle
  // (upload callbacks, resolve) and must not trigger re-renders.
  const displaySrcToKey = useRef<Record<string, string>>({});

  // Save guard: map known transient srcs back to keys, then DROP any image whose src is
  // still not a key (e.g. an object URL for an upload mid-flight). Guarantees a blur-save
  // during the upload window can never persist a blob:/presigned URL into note content.
  const serialize = useCallback(
    (ed: Editor) =>
      dropUnresolvedImages(srcsToKeys(ed.storage.markdown.getMarkdown(), displaySrcToKey.current)),
    []
  );

  const updateButton = useCallback((ed: Editor) => {
    if (!ed.isActive('heading') || !containerRef.current) {
      setButtonY(null);
      return;
    }
    const { from } = ed.state.selection;
    const coords = ed.view.coordsAtPos(from);
    const rect = containerRef.current.getBoundingClientRect();
    setButtonY((coords.top + coords.bottom) / 2 - rect.top);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Markdown, Image],
    content: value,
    editorProps: {
      attributes: {
        'aria-label': 'Note content',
        'data-testid': 'note-content',
        class: styles.contentInput,
      },
      handlePaste: (_view, event): boolean => dataTransferHandlerRef.current(event.clipboardData),
      handleDrop: (_view, event): boolean =>
        dataTransferHandlerRef.current((event as DragEvent).dataTransfer),
    },
    onUpdate: ({ editor: ed }) => {
      onChange(serialize(ed));
      updateButton(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => updateButton(ed),
    onFocus: ({ editor: ed }) => updateButton(ed),
    onBlur: () => {
      setButtonY(null);
      onBlur();
    },
  });

  // Replace the src of every image node currently rendering `oldSrc`.
  const swapImageSrc = useCallback((ed: Editor, oldSrc: string, newSrc: string) => {
    const { state } = ed;
    const tr = state.tr;
    let changed = false;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === oldSrc) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newSrc });
        changed = true;
      }
    });
    if (changed) ed.view.dispatch(tr);
  }, []);

  const removeImage = useCallback((ed: Editor, src: string) => {
    const { state } = ed;
    const tr = state.tr;
    const positions: { from: number; to: number }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === src) {
        positions.push({ from: pos, to: pos + node.nodeSize });
      }
    });
    for (const { from, to } of positions.reverse()) tr.delete(from, to);
    if (positions.length > 0) ed.view.dispatch(tr);
  }, []);

  const uploadImage = useCallback(
    async (ed: Editor, file: File, previewUrl: string) => {
      try {
        // Presign FIRST, then seed the key mapping and insert the image together, before
        // any onChange (save) can fire. This makes the serialized content carry the stable
        // key from the very first save — so a blur-save *during* the background PUT below
        // neither persists a transient blob URL (data-rot) nor loses the image.
        const presign = await presignUpload(noteId, {
          contentType: file.type,
          contentLength: file.size,
        });
        if (ed.isDestroyed) {
          URL.revokeObjectURL(previewUrl);
          return;
        }
        displaySrcToKey.current[previewUrl] = presign.key;
        ed.chain().focus().setImage({ src: previewUrl }).run();
        const put = await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!put.ok) throw new Error(`upload failed: ${put.status}`);
      } catch {
        delete displaySrcToKey.current[previewUrl];
        URL.revokeObjectURL(previewUrl);
        if (!ed.isDestroyed) {
          removeImage(ed, previewUrl);
          onChange(serialize(ed));
        }
        showError("Couldn't attach the image. Please try again.");
      }
    },
    [noteId, onChange, removeImage, serialize, showError]
  );

  const insertAndUpload = useCallback(
    (ed: Editor, file: File) => {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        showError("That image type isn't supported.");
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        showError('That image is larger than 10 MB.');
        return;
      }
      // The node is inserted inside uploadImage, after presign seeds the key mapping —
      // never before, so an unmapped object URL can't reach a save.
      const previewUrl = URL.createObjectURL(file);
      void uploadImage(ed, file, previewUrl);
    },
    [showError, uploadImage]
  );

  const handleImageDataTransfer = useCallback(
    (data: DataTransfer | null): boolean => {
      if (!editor || !data) return false;
      const images = [...data.files].filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return false;
      for (const file of images) insertAndUpload(editor, file);
      return true;
    },
    [editor, insertAndUpload]
  );
  useEffect(() => {
    dataTransferHandlerRef.current = handleImageDataTransfer;
  }, [handleImageDataTransfer]);

  const handlePickFiles = useCallback(
    (files: FileList | null) => {
      if (!editor || !files) return;
      for (const file of [...files]) insertAndUpload(editor, file);
    },
    [editor, insertAndUpload]
  );

  // Resolve stored keys to presigned URLs for display. Runs when the loaded
  // content first contains unresolved keys; the `ignore` flag drops a stale
  // response if the editor changed before the resolve returned. setState-free —
  // the only mutation is a ProseMirror dispatch inside the `.then`.
  const resolvedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    const keys = extractImageKeys(value);
    if (keys.length === 0) return;
    const signature = `${noteId}:${keys.join(',')}`;
    if (resolvedFor.current === signature) return;
    resolvedFor.current = signature;
    let ignore = false;
    resolveImages(noteId, keys)
      .then((urls) => {
        if (ignore) return;
        for (const [key, url] of Object.entries(urls)) {
          displaySrcToKey.current[url] = key;
          swapImageSrc(editor, key, url);
        }
      })
      .catch(() => {
        // Leave resolvedFor set: a transient resolve failure must not retry-storm on
        // every keystroke. A different image set (new signature) still attempts afresh.
      });
    return () => {
      ignore = true;
    };
  }, [editor, noteId, value, swapImageSrc]);

  return (
    <div ref={containerRef} className={styles.noteEditorContainer}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolbarButton}
          data-testid="insert-image-button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Insert image"
        >
          <ImageIcon />
          <span>Image</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className={styles.fileInput}
          data-testid="image-file-input"
          aria-label="Choose image to insert"
          onChange={(e) => {
            handlePickFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </div>
      {buttonY !== null && editor && (
        <button
          className={styles.discussedButton}
          style={{ top: buttonY }}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.commands.toggleStrike();
          }}
          aria-label="Mark as discussed"
        >
          ✓
        </button>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function ImageIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
