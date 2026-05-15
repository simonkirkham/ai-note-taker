import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/ping', () => HttpResponse.json({ ok: true })),
  http.get('/notes', () => HttpResponse.json({ items: [] })),
  http.get('/folders', () => HttpResponse.json({ folders: [] })),
  http.get('/notes/cards', () => HttpResponse.json({ cards: [] })),
  http.get('/tags', () => HttpResponse.json({ tags: [] })),
  http.get('/todos', () => HttpResponse.json({ items: [] })),
  http.get('/notes/:noteId', () =>
    HttpResponse.json({
      noteId: 'note-1',
      title: 'Test Note',
      content: '',
      date: null,
      tags: [],
    }),
  ),
  http.put('/notes/:noteId/content', () => new HttpResponse(null, { status: 204 })),
  http.patch('/notes/:noteId/date', () => new HttpResponse(null, { status: 204 })),
  http.get('/notes/:noteId/actions', () => HttpResponse.json({ actions: [] })),
  http.post('/notes/:noteId/actions', () =>
    HttpResponse.json({ actionId: 'new-action-id' }, { status: 201 }),
  ),
  http.post('/notes/:noteId/actions/:actionId/complete', () => new HttpResponse(null, { status: 200 })),
  http.post('/notes/:noteId/actions/:actionId/reopen', () => new HttpResponse(null, { status: 200 })),
  http.delete('/notes/:noteId/actions/:actionId', () => new HttpResponse(null, { status: 204 })),
]
