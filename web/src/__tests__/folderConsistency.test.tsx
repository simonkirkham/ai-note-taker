import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { clearLatestToken } from '../api/consistencyTokens'
import { createFolder, deleteFolder, getFolders } from '../api/folders'
import { server } from '../test/setup'

const FOLDER_ID = '33333333-3333-3333-3333-333333333333'

afterEach(() => {
  clearLatestToken('folders')
})

describe('folders read-your-writes (RYW-3b)', () => {
  it('GET /folders after a create carries If-Consistent-With with the write token', async () => {
    let sentToken: string | null = null
    server.use(
      http.post('/api/folders', () =>
        HttpResponse.json({ folderId: FOLDER_ID }, { headers: { 'X-Consistency-Token': `folder-${FOLDER_ID}@1` } })),
      http.get('/api/folders', ({ request }) => {
        sentToken = request.headers.get('If-Consistent-With')
        return HttpResponse.json({ folders: [{ folderId: FOLDER_ID, name: 'People', children: [] }] })
      }),
    )

    await createFolder('People')
    const folders = await getFolders()

    expect(sentToken).toBe(`folder-${FOLDER_ID}@1`)
    expect(folders[0].folderId).toBe(FOLDER_ID)
  })

  it('a delete write token gates the next folders read (proves projector-delete is awaited)', async () => {
    let sentToken: string | null = null
    server.use(
      http.delete(`/api/folders/${FOLDER_ID}`, () =>
        new HttpResponse(null, { status: 204, headers: { 'X-Consistency-Token': `folder-${FOLDER_ID}@2` } })),
      http.get('/api/folders', ({ request }) => {
        sentToken = request.headers.get('If-Consistent-With')
        return HttpResponse.json({ folders: [] })
      }),
    )

    await deleteFolder(FOLDER_ID)
    const folders = await getFolders()

    expect(sentToken).toBe(`folder-${FOLDER_ID}@2`)
    expect(folders).toEqual([])
  })

  it('a stale folders read retries (bounded) and returns what it has without throwing', async () => {
    let gets = 0
    server.use(
      http.post('/api/folders', () =>
        HttpResponse.json({ folderId: FOLDER_ID }, { headers: { 'X-Consistency-Token': `folder-${FOLDER_ID}@1` } })),
      http.get('/api/folders', () => {
        gets++
        return HttpResponse.json(
          { folders: [{ folderId: FOLDER_ID, name: 'People', children: [] }] },
          { headers: { 'X-Consistency': 'stale' } },
        )
      }),
    )

    await createFolder('People')
    const folders = await getFolders()

    expect(gets).toBe(3)
    expect(folders[0].folderId).toBe(FOLDER_ID)
  })
})
