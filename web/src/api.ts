const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export interface NoteItem {
  noteId: string
  title: string
}

export async function createNote(): Promise<{ noteId: string }> {
  const res = await fetch(`${base}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'null',
  })
  if (!res.ok) throw new Error(`POST /notes failed: ${res.status}`)
  return res.json()
}

export async function renameNote(noteId: string, title: string): Promise<void> {
  const res = await fetch(`${base}/notes/${noteId}/title`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`PATCH /notes/${noteId}/title failed: ${res.status}`)
}

export async function listNotes(): Promise<NoteItem[]> {
  const res = await fetch(`${base}/notes`)
  if (!res.ok) throw new Error(`GET /notes failed: ${res.status}`)
  const body: { items: NoteItem[] } = await res.json()
  return body.items
}
