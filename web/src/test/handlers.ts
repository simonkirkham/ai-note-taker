import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/notes', () => HttpResponse.json({ items: [] })),
  http.get('/api/folders', () => HttpResponse.json({ folders: [] })),
  http.get('/api/notes/cards', () => HttpResponse.json({ cards: [] })),
  http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
  http.get('/api/todos', () => HttpResponse.json({ items: [] })),
  http.post('/api/todos', () => HttpResponse.json({ todoId: 'new-todo-id' })),
  http.post('/api/todos/:todoId/complete', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/todos/:todoId/reopen', () => new HttpResponse(null, { status: 204 })),
  http.delete('/api/todos/:todoId', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [] })),
  http.get('/api/notes/:noteId', () =>
    HttpResponse.json({
      noteId: 'note-1',
      title: 'Test Note',
      content: '',
      date: null,
      tags: [],
    }),
  ),
  http.put('/api/notes/:noteId/content', () => new HttpResponse(null, { status: 204 })),
  http.patch('/api/notes/:noteId/date', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/notes/:noteId/actions', () => HttpResponse.json({ actions: [] })),
  http.post('/api/notes/:noteId/actions', () =>
    HttpResponse.json({ actionId: 'new-action-id' }, { status: 201 }),
  ),
  http.post('/api/notes/:noteId/actions/:actionId/complete', () => new HttpResponse(null, { status: 200 })),
  http.post('/api/notes/:noteId/actions/:actionId/reopen', () => new HttpResponse(null, { status: 200 })),
  http.delete('/api/notes/:noteId', () => new HttpResponse(null, { status: 204 })),
  http.delete('/api/notes/:noteId/actions/:actionId', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/notes/:noteId/tags', () => new HttpResponse(null, { status: 204 })),
  http.delete('/api/notes/:noteId/tags/:tag', () => new HttpResponse(null, { status: 204 })),
  http.put('/api/notes/:noteId/folder', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/transcription/credentials', () =>
    HttpResponse.json({
      accessKeyId: 'ASIATEST',
      secretAccessKey: 'fakesecret',
      sessionToken: 'faketoken',
      expiration: '2099-01-01T00:00:00Z',
      region: 'eu-west-1',
    }),
  ),
  http.post('/api/notes/:noteId/transcription', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/notes/:noteId/analyse', () => new HttpResponse(null, { status: 204 })),
]
