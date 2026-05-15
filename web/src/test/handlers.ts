import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/ping', () => HttpResponse.json({ ok: true })),
  http.get('/notes/cards', () => HttpResponse.json({ cards: [] })),
  http.get('/tags', () => HttpResponse.json({ tags: [] })),
  http.get('/todos', () => HttpResponse.json({ items: [] })),
]
