import { lazy, Suspense } from 'react'
import { recordRumEvent } from '../rum'
import ErrorBoundary from './ErrorBoundary'
import styles from './LazyNoteEditor.module.css'
import type { NoteEditorProps } from './NoteEditor'

// 19-I1: the Tiptap editor is heavy and only needed once a note is open, so it
// loads as its own chunk behind Suspense — out of the entry bundle. The fallback
// reserves the editor's vertical space to keep CLS ≤ 0.1, and a failed chunk load
// degrades to a recoverable error (not a blank pane) and is reported to RUM.
const NoteEditor = lazy(() => import('./NoteEditor'))

function reportChunkError(error: Error): void {
  recordRumEvent('lazyChunkError', { component: 'NoteEditor', message: error.message })
}

export default function LazyNoteEditor(props: NoteEditorProps) {
  return (
    <ErrorBoundary
      onError={reportChunkError}
      fallback={
        <div role="alert" className={styles.error}>
          <p>The editor couldn’t load.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      }
    >
      <Suspense
        fallback={
          <div
            data-testid="editor-loading"
            role="status"
            aria-label="Loading editor"
            className={styles.loading}
            style={{ minHeight: 'calc(100vh - 360px)' }}
          />
        }
      >
        <NoteEditor {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
