import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { clearLatestToken } from '../api/consistencyTokens'
import { createWorkspace, getWorkspaces } from '../api/workspaces'
import { server } from '../test/setup'

const WORKSPACE_ID = 'ws00000000000000000000000000000a'

afterEach(() => {
  clearLatestToken('workspaces')
})

describe('workspaces read-your-writes (RYW-3b)', () => {
  it('GET /workspaces after a create carries If-Consistent-With with the write token', async () => {
    let sentToken: string | null = null
    server.use(
      http.post('/api/workspaces', () =>
        HttpResponse.json({ workspaceId: WORKSPACE_ID }, { headers: { 'X-Consistency-Token': `workspace-${WORKSPACE_ID}@1` } })),
      http.get('/api/workspaces', ({ request }) => {
        sentToken = request.headers.get('If-Consistent-With')
        return HttpResponse.json({ workspaces: [{ workspaceId: WORKSPACE_ID, name: 'Work', isDefault: false }] })
      }),
    )

    await createWorkspace('Work')
    const workspaces = await getWorkspaces()

    expect(sentToken).toBe(`workspace-${WORKSPACE_ID}@1`)
    expect(workspaces[0].workspaceId).toBe(WORKSPACE_ID)
  })

  it('a stale workspaces read retries (bounded) and returns what it has without throwing', async () => {
    let gets = 0
    server.use(
      http.post('/api/workspaces', () =>
        HttpResponse.json({ workspaceId: WORKSPACE_ID }, { headers: { 'X-Consistency-Token': `workspace-${WORKSPACE_ID}@1` } })),
      http.get('/api/workspaces', () => {
        gets++
        return HttpResponse.json(
          { workspaces: [{ workspaceId: WORKSPACE_ID, name: 'Work', isDefault: false }] },
          { headers: { 'X-Consistency': 'stale' } },
        )
      }),
    )

    await createWorkspace('Work')
    const workspaces = await getWorkspaces()

    expect(gets).toBe(3)
    expect(workspaces[0].workspaceId).toBe(WORKSPACE_ID)
  })
})
