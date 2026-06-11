import { http, HttpResponse, type HttpResponseResolver } from 'msw'

// 23-D: the api client prefixes workspace-scoped paths with `/w/:wsId` only when a
// WorkspaceProvider is mounted. Component tests render a subtree without the router
// (rootless requests); full-App routing tests run under the provider (prefixed
// requests). So every scoped handler is registered for BOTH forms.
const methods = { get: http.get, post: http.post, put: http.put, patch: http.patch, delete: http.delete }
function scoped(method: keyof typeof methods, suffix: string, resolver: HttpResponseResolver) {
  return [methods[method](`/api${suffix}`, resolver), methods[method](`/api/w/:wsId${suffix}`, resolver)]
}

export const handlers = [
  ...scoped('get', '/notes', () => HttpResponse.json({ items: [] })),
  ...scoped('get', '/folders', () => HttpResponse.json({ folders: [] })),
  ...scoped('get', '/notes/cards', () => HttpResponse.json({ cards: [] })),
  ...scoped('get', '/notes/search', () => HttpResponse.json({ items: [] })),
  ...scoped('get', '/tags', () => HttpResponse.json({ tags: [] })),
  ...scoped('get', '/todos', () => HttpResponse.json({ items: [] })),
  ...scoped('post', '/todos', () => HttpResponse.json({ todoId: 'new-todo-id' })),
  ...scoped('post', '/todos/:todoId/complete', () => new HttpResponse(null, { status: 204 })),
  ...scoped('post', '/todos/:todoId/reopen', () => new HttpResponse(null, { status: 204 })),
  ...scoped('delete', '/todos/:todoId', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/calendar/:date', () => HttpResponse.json({ meetings: [] })),
  ...scoped('get', '/notes/:noteId', () =>
    HttpResponse.json({
      noteId: 'note-1',
      title: 'Test Note',
      content: '',
      date: null,
      tags: [],
    }),
  ),
  ...scoped('put', '/notes/:noteId/content', () => new HttpResponse(null, { status: 204 })),
  ...scoped('patch', '/notes/:noteId/date', () => new HttpResponse(null, { status: 204 })),
  ...scoped('get', '/notes/:noteId/actions', () => HttpResponse.json({ actions: [] })),
  ...scoped('post', '/notes/:noteId/actions', () =>
    HttpResponse.json({ actionId: 'new-action-id' }, { status: 201 }),
  ),
  ...scoped('post', '/notes/:noteId/actions/:actionId/complete', () => new HttpResponse(null, { status: 200 })),
  ...scoped('post', '/notes/:noteId/actions/:actionId/reopen', () => new HttpResponse(null, { status: 200 })),
  ...scoped('delete', '/notes/:noteId', () => new HttpResponse(null, { status: 204 })),
  ...scoped('delete', '/notes/:noteId/actions/:actionId', () => new HttpResponse(null, { status: 204 })),
  ...scoped('post', '/notes/:noteId/tags', () => new HttpResponse(null, { status: 204 })),
  ...scoped('delete', '/notes/:noteId/tags/:tag', () => new HttpResponse(null, { status: 204 })),
  ...scoped('put', '/notes/:noteId/folder', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/transcription/credentials', () =>
    HttpResponse.json({
      accessKeyId: 'ASIATEST',
      secretAccessKey: 'fakesecret',
      sessionToken: 'faketoken',
      expiration: '2099-01-01T00:00:00Z',
      region: 'eu-west-1',
    }),
  ),
  ...scoped('post', '/notes/:noteId/transcription', () => new HttpResponse(null, { status: 204 })),
  ...scoped('post', '/notes/:noteId/analyse', () => new HttpResponse(null, { status: 204 })),
]
