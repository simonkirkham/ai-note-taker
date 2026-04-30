import { useState, useEffect, useRef } from 'react'
import { createNote, renameNote, listNotes, NoteItem } from './api'

type View = { kind: 'list' } | { kind: 'note'; noteId: string }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'list' })

  if (view.kind === 'note') {
    return <NoteView noteId={view.noteId} onBack={() => setView({ kind: 'list' })} />
  }
  return <ListView onOpen={(noteId) => setView({ kind: 'note', noteId })} />
}

function ListView({ onOpen }: { onOpen: (noteId: string) => void }) {
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    listNotes().then(setNotes).finally(() => setLoading(false))
  }, [])

  async function handleNewNote() {
    setCreating(true)
    try {
      const { noteId } = await createNote()
      onOpen(noteId)
    } finally {
      setCreating(false)
    }
  }

  return (
    <main style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>Notes</h1>
        <button onClick={handleNewNote} disabled={creating}>
          {creating ? 'Creating…' : 'New Note'}
        </button>
      </div>
      {loading && <p>Loading…</p>}
      {!loading && notes.length === 0 && <p style={{ color: '#888' }}>No notes yet. Create one to get started.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
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

function NoteView({ noteId, onBack }: { noteId: string; onBack: () => void }) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleBlur() {
    setSaving(true)
    try {
      await renameNote(noteId, title)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem', fontFamily: 'sans-serif' }}>
      <button onClick={onBack} style={{ marginBottom: '1rem', cursor: 'pointer' }}>← Back</button>
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={handleBlur}
        placeholder="Note title…"
        style={{ display: 'block', width: '100%', fontSize: '1.5rem', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: 4 }}
      />
      {saving && <p style={{ color: '#888', fontSize: '0.875rem' }}>Saving…</p>}
    </main>
  )
}
