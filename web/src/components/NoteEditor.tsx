import Link from '@tiptap/extension-link';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TaskItem } from '@tiptap/extension-task-item';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from 'tiptap-markdown';
import { presignUpload, resolveImages } from '../api/notes';
import { BlankLineParagraph } from '../lib/blankLineParagraph';
import { emojifyMarkdown } from '../lib/emoji';
import { EmojiShortcode } from '../lib/emojiExtension';
import { hasDisallowedScheme } from '../lib/linkScheme';
import { MarkdownTable } from '../lib/markdownTable';
import { MarkdownTaskList } from '../lib/markdownTaskList';
import {
  dropUnresolvedImages,
  extractImageKeys,
  keysToSrcs,
  srcsToKeys,
  stripImageKeys,
} from '../lib/noteImages';
import { ImageWithResize } from './imageWithResize';
import styles from './NoteEditor.module.css';
import { useToast } from './toastContext';

export interface NoteEditorProps {
  noteId: string;
  value: string;
  onChange: (md: string) => void;
  onBlur: () => void;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Only these schemes may render as a live anchor in note content. A malicious
// scheme (javascript:/data:/vbscript:) in user- or AI-derived markdown is
// neutralised on every path Tiptap gates through isAllowedUri: content-load,
// typed-autolink, and pasted/programmatic setLink. defense-in-depth — do not
// rely on StarterKit's bundled Link default, which a Tiptap upgrade could loosen.
const ALLOWED_LINK_PROTOCOLS = ['http', 'https', 'mailto'];

export default function NoteEditor({ noteId, value, onChange, onBlur }: NoteEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showError } = useToast();

  // Mirrors the editor's editability for the toolbar UI (the editor itself is driven
  // imperatively via setEditable). False while a BUG-24 image resolve is pending so the
  // insert control is disabled; flipped true once resolve applies (or fails). Seeded false
  // only for a note that mounts read-only (has image keys to resolve).
  const [canInsert, setCanInsert] = useState(() => extractImageKeys(value).length === 0);

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

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // BUG-40: swap StarterKit's paragraph for BlankLineParagraph so blank lines a user
      // leaves between sections survive the markdown round-trip (the default serializer drops
      // empty paragraphs, condensing the note on save).
      StarterKit.configure({ link: false, paragraph: false }),
      BlankLineParagraph,
      Markdown,
      // 46-A: GFM tables. MarkdownTable overrides tiptap-markdown's default table
      // serializer to preserve column alignment on save (resizable off — notes don't
      // need column-drag handles). Row/header/cell are the standard schema nodes.
      MarkdownTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      // 46-B: interactive task lists. MarkdownTaskList serialises tight (no blank line
      // between items) to match bulletList; TaskItem renders the clickable checkbox and
      // nests. A checkbox toggle updates the doc, so onUpdate fires and the note saves.
      MarkdownTaskList,
      TaskItem.configure({ nested: true }),
      // 46-C: convert :shortcode: to emoji as the user types (load-time content is
      // converted via emojifyMarkdown below). Unknown codes and codes in code spans
      // are left as-is.
      EmojiShortcode,
      ImageWithResize,
      Link.configure({
        protocols: ALLOWED_LINK_PROTOCOLS,
        // Enforce the allowlist ourselves — Tiptap's protocols-only config still
        // permits its built-in superset (ftp/tel/…); see hasDisallowedScheme.
        // Schemeless / relative URLs are left to defaultValidate.
        isAllowedUri: (url, { defaultValidate }) =>
          !hasDisallowedScheme(url, ALLOWED_LINK_PROTOCOLS) && defaultValidate(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
    ],
    // BUG-24: never let the parser see a bare S3 key as an <img src>, or the browser
    // fetches it relative to the SPA route (`…/notes/notes/{id}/{img}.png` → 403) during
    // tiptap-markdown's parse, before any ImageNodeView exists. Mount with the keys
    // stripped (text shows instantly); the resolve effect below re-inserts the images as
    // presigned URLs via setContent — so the only image the parser ever sees is a
    // presigned URL (→ the desired `?X-Amz-…` 200 GET), never a bare key.
    content: emojifyMarkdown(stripImageKeys(value)),
    // While image keys are pending resolve the doc has them stripped out; keep the editor
    // read-only until resolve re-inserts them, so a fast edit-then-save in that sub-second
    // window can't persist the stripped (image-less) content. Re-enabled in the resolve
    // .then / .catch below. Notes with no image keys mount editable immediately.
    editable: extractImageKeys(value).length === 0,
    editorProps: {
      attributes: {
        'aria-label': 'Note content',
        'data-testid': 'note-content',
        // CHANGE-37: contenteditable defaults to spellcheck on, so the squiggles were already
        // there — pinned explicitly so a future ProseMirror/Tiptap default can't drop them
        // silently. Acting on a squiggle needed the desktop context menu (Electron ships no
        // default one); in the browser the native right-click menu already works.
        spellcheck: 'true',
        class: styles.contentInput,
      },
      handlePaste: (_view, event): boolean => dataTransferHandlerRef.current(event.clipboardData),
      handleDrop: (_view, event): boolean =>
        dataTransferHandlerRef.current((event).dataTransfer),
    },
    onUpdate: ({ editor: ed }) => {
      onChange(serialize(ed));
    },
    onBlur: () => {
      onBlur();
    },
  });

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
      if (!editor || !canInsert || !data) return false;
      const images = [...data.files].filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return false;
      for (const file of images) insertAndUpload(editor, file);
      return true;
    },
    [editor, canInsert, insertAndUpload]
  );
  useEffect(() => {
    dataTransferHandlerRef.current = handleImageDataTransfer;
  }, [handleImageDataTransfer]);

  const handlePickFiles = useCallback(
    (files: FileList | null) => {
      // Ignore inserts while the editor is read-only (BUG-24 pending-resolve window): a
      // programmatic setImage isn't blocked by editable=false, and the resolve setContent
      // would then discard the just-inserted node and orphan its uploaded S3 object.
      if (!editor || !canInsert || !files) return;
      for (const file of [...files]) insertAndUpload(editor, file);
    },
    [editor, canInsert, insertAndUpload]
  );

  // Resolve-before-parse (BUG-24): the editor mounts with image keys stripped, so the
  // parser never fetches a bare key. This runs ONCE per note (the editor is keyed by
  // noteId, so it remounts per note) on the mount-time content: resolveImages → seed the
  // display→key save map → setContent the *resolved* markdown (presigned URLs, never a
  // bare key) and re-enable editing. Firing once on the captured initial value — not on
  // every `value` change — is what keeps a later image upload (which changes the key set)
  // from re-firing a whole-doc setContent that would reset selection / clobber live edits;
  // an uploaded image is already shown via the blob→presigned upload flow and needs no
  // resolve here. No setState in the effect body — the editor calls and the setCanInsert
  // run inside the async `.then`/`.catch` (the set-state-in-effect lint rule is satisfied).
  // `ignore`/`isDestroyed` drop a stale or unmounted response.
  const didResolve = useRef(false);
  const initialValueRef = useRef(value);
  useEffect(() => {
    if (!editor || didResolve.current) return;
    const initial = initialValueRef.current;
    const keys = extractImageKeys(initial);
    if (keys.length === 0) return;
    didResolve.current = true;
    let ignore = false;
    resolveImages(noteId, keys)
      .then((urls) => {
        if (ignore || editor.isDestroyed) return;
        for (const [key, url] of Object.entries(urls)) {
          displaySrcToKey.current[url] = key;
        }
        // emitUpdate:false so the resolve doesn't dirty the draft; the resolved markdown
        // has no bare-key src, so this setContent never triggers the BUG-24 fetch.
        editor.commands.setContent(emojifyMarkdown(keysToSrcs(initial, urls)), {
          emitUpdate: false,
        });
        editor.setEditable(true);
        setCanInsert(true);
      })
      .catch(() => {
        // Re-enable editing even on a transient resolve failure so the note isn't stuck
        // read-only; the stored content still holds the keys and re-resolves on next open.
        if (!ignore && !editor.isDestroyed) {
          editor.setEditable(true);
          setCanInsert(true);
        }
      });
    return () => {
      ignore = true;
    };
  }, [editor, noteId]);

  return (
    <div className={styles.noteEditorContainer}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolbarButton}
          data-testid="insert-image-button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Insert image"
          disabled={!canInsert}
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
