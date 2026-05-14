import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/ping', () => HttpResponse.json({ ok: true })),
]
