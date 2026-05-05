import { useState, useEffect, useRef } from 'react'
import { createNote, renameNote, listNotes, NoteItem } from './api'

type View = { kind: 'list' } | { kind: 'note'; noteId: string }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    listNotes().then(setNotes).finally(() => setLoading(false))
  }, [])

  async function handleNewNote() {
    setCreating(true)
    setCreateError(null)
    try {
      const { noteId } = await createNote()
      setNotes(prev => [...prev, { noteId, title: '' }])
      setView({ kind: 'note', noteId })
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create note')
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(noteId: string, title: string) {
    const previous = notes.find(n => n.noteId === noteId)?.title ?? ''
    setNotes(prev => prev.map(n => n.noteId === noteId ? { ...n, title } : n))
    try {
      await renameNote(noteId, title)
    } catch {
      setNotes(prev => prev.map(n => n.noteId === noteId ? { ...n, title: previous } : n))
    }
  }

  if (view.kind === 'note') {
    const currentTitle = notes.find(n => n.noteId === view.noteId)?.title ?? ''
    return (
      <NoteView
        noteId={view.noteId}
        initialTitle={currentTitle}
        onRename={handleRename}
        onBack={() => setView({ kind: 'list' })}
      />
    )
  }

  return (
    <ListView
      notes={notes}
      loading={loading}
      creating={creating}
      createError={createError}
      onNewNote={handleNewNote}
      onOpen={(noteId) => setView({ kind: 'note', noteId })}
    />
  )
}

function ListView({
  notes,
  loading,
  creating,
  createError,
  onNewNote,
  onOpen,
}: {
  notes: NoteItem[]
  loading: boolean
  creating: boolean
  createError: string | null
  onNewNote: () => void
  onOpen: (noteId: string) => void
}) {
  return (
    <main style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>Notes</h1>
        <button data-testid="new-note-button" onClick={onNewNote} disabled={creating}>
          {creating ? 'Creating…' : 'New Note'}
        </button>
      </div>
      {createError && <p data-testid="create-error" style={{ color: 'red', fontSize: '0.875rem' }}>{createError}</p>}
      {loading && <p>Loading…</p>}
      {!loading && notes.length === 0 && <p style={{ color: '#888' }}>No notes yet. Create one to get started.</p>}
      <ul data-testid="note-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {notes.map((n) => (
          <li key={n.noteId} style={{ borderBottom: '1px solid #eee', padding: '0.75rem 0' }}>
            <button
              onClick={() => onOpen(n.noteId)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: 0 }}
            >
              {n.title || <em style={{ color: '#aaa' }}>Untitled</em>}
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

function NoteView({
  noteId,
  initialTitle,
  onRename,
  onBack,
}: {
  noteId: string
  initialTitle: string
  onRename: (noteId: string, title: string) => void
  onBack: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <main style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem', fontFamily: 'sans-serif' }}>
      <button data-testid="back-button" onClick={onBack} style={{ marginBottom: '1rem', cursor: 'pointer' }}>← Back</button>
      <input
        data-testid="note-title-input"
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => onRename(noteId, title)}
        placeholder="Note title…"
        style={{ display: 'block', width: '100%', fontSize: '1.5rem', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: 4 }}
      />
    </main>
  )
}
