import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { clearLatestToken, clearStreamToken } from '../api/consistencyTokens'
import { editContent, getNoteCards, getNoteDetail, renameNote } from '../api/notes'
import { server } from '../test/setup'

const NOTE_ID = '11111111-1111-1111-1111-111111111111'

// The token store is sessionStorage-global; clear what each test sets so nothing leaks.
afterEach(() => {
  clearStreamToken(`note#${NOTE_ID}`)
  clearLatestToken('noteCards')
})

describe('notes read-your-writes (RYW-2)', () => {
  it('GET /notes/{id} after a rename carries If-Consistent-With with the write token', async () => {
    let sentToken: string | null = null
    server.use(
      http.patch(`/api/notes/${NOTE_ID}/title`, () =>
        new HttpResponse(null, { status: 200, headers: { 'X-Consistency-Token': `note#${NOTE_ID}@5` } })),
      http.get(`/api/notes/${NOTE_ID}`, ({ request }) => {
        sentToken = request.headers.get('If-Consistent-With')
        return HttpResponse.json(noteDetail('Renamed'))
      }),
    )

    await renameNote(NOTE_ID, 'Renamed')
    const detail = await getNoteDetail(NOTE_ID)

    expect(sentToken).toBe(`note#${NOTE_ID}@5`)
    expect(detail.title).toBe('Renamed')
  })

  it('GET /notes/cards after a note write carries the latest note write token', async () => {
    let sentToken: string | null = null
    server.use(
      http.put(`/api/notes/${NOTE_ID}/content`, () =>
        new HttpResponse(null, { status: 204, headers: { 'X-Consistency-Token': `note#${NOTE_ID}@8` } })),
      http.get('/api/notes/cards', ({ request }) => {
        sentToken = request.headers.get('If-Consistent-With')
        return HttpResponse.json({ cards: [] })
      }),
    )

    await editContent(NOTE_ID, 'new body')
    await getNoteCards()

    expect(sentToken).toBe(`note#${NOTE_ID}@8`)
  })

  it('a stale note-detail read clears nothing and keeps the token for the next read', async () => {
    let gets = 0
    server.use(
      http.patch(`/api/notes/${NOTE_ID}/title`, () =>
        new HttpResponse(null, { status: 200, headers: { 'X-Consistency-Token': `note#${NOTE_ID}@2` } })),
      http.get(`/api/notes/${NOTE_ID}`, () => {
        gets++
        return HttpResponse.json(noteDetail('Renamed'), { headers: { 'X-Consistency': 'stale' } })
      }),
    )

    await renameNote(NOTE_ID, 'Renamed')
    const detail = await getNoteDetail(NOTE_ID)

    // Initial + 2 bounded retries, all stale → returns what it has without throwing.
    expect(gets).toBe(3)
    expect(detail.title).toBe('Renamed')
  })
})

function noteDetail(title: string) {
  return {
    noteId: NOTE_ID,
    title,
    content: '',
    date: null,
    tags: [],
    transcriptText: null,
    transcriptDraft: null,
    summary: null,
    discussionPoints: [],
    decisions: [],
    summaryModelId: null,
    summaryPromptVersion: null,
    recurringSeriesId: null,
    isRecurring: false,
    linkedMeeting: null,
  }
}
