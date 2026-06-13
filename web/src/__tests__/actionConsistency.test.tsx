import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { addAction, completeAction, getActions } from '../api/actions'
import { clearLatestToken } from '../api/consistencyTokens'
import { server } from '../test/setup'

const NOTE_ID = '11111111-1111-1111-1111-111111111111'
const ACTION_ID = '22222222-2222-2222-2222-222222222222'

// The token store is sessionStorage-global; clear what each test sets so nothing leaks.
afterEach(() => {
  clearLatestToken(`actions:${NOTE_ID}`)
})

describe('actions read-your-writes (RYW-3a)', () => {
  it('GET /notes/{id}/actions after an add carries If-Consistent-With with the write token', async () => {
    let sentToken: string | null = null
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, () =>
        HttpResponse.json({ actionId: ACTION_ID }, { headers: { 'X-Consistency-Token': `action#${ACTION_ID}@1` } })),
      http.get(`/api/notes/${NOTE_ID}/actions`, ({ request }) => {
        sentToken = request.headers.get('If-Consistent-With')
        return HttpResponse.json({ actions: [action('Ship it')] })
      }),
    )

    await addAction(NOTE_ID, 'Ship it')
    const actions = await getActions(NOTE_ID)

    expect(sentToken).toBe(`action#${ACTION_ID}@1`)
    expect(actions[0].description).toBe('Ship it')
  })

  it('the actions read waits on the most recent action write (complete overwrites the scope token)', async () => {
    let sentToken: string | null = null
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions/${ACTION_ID}/complete`, () =>
        new HttpResponse(null, { status: 200, headers: { 'X-Consistency-Token': `action#${ACTION_ID}@2` } })),
      http.get(`/api/notes/${NOTE_ID}/actions`, ({ request }) => {
        sentToken = request.headers.get('If-Consistent-With')
        return HttpResponse.json({ actions: [action('Ship it', true)] })
      }),
    )

    await completeAction(NOTE_ID, ACTION_ID)
    await getActions(NOTE_ID)

    expect(sentToken).toBe(`action#${ACTION_ID}@2`)
  })

  it('a stale actions read retries (bounded) and returns what it has without throwing', async () => {
    let gets = 0
    server.use(
      http.post(`/api/notes/${NOTE_ID}/actions`, () =>
        HttpResponse.json({ actionId: ACTION_ID }, { headers: { 'X-Consistency-Token': `action#${ACTION_ID}@1` } })),
      http.get(`/api/notes/${NOTE_ID}/actions`, () => {
        gets++
        return HttpResponse.json({ actions: [action('Ship it')] }, { headers: { 'X-Consistency': 'stale' } })
      }),
    )

    await addAction(NOTE_ID, 'Ship it')
    const actions = await getActions(NOTE_ID)

    // Initial + 2 bounded retries, all stale → returns what it has without throwing.
    expect(gets).toBe(3)
    expect(actions[0].description).toBe('Ship it')
  })
})

function action(description: string, completed = false) {
  return {
    actionId: ACTION_ID,
    description,
    completed,
    addedAt: '2026-01-01T00:00:00Z',
    completedAt: completed ? '2026-01-02T00:00:00Z' : null,
  }
}
