import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearLatestToken,
  clearStreamToken,
  getLatestToken,
  getStreamToken,
  setLatestToken,
  setStreamToken,
} from '../api/consistencyTokens'
import { editContent, getNoteCards, getNoteDetail, renameNote } from '../api/notes'
import { tagNote } from '../api/tags'
import { server } from '../test/setup'

const NOTE_ID = '11111111-1111-1111-1111-111111111111'
const NOTE_ID_2 = '22222222-2222-2222-2222-222222222222'

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

// BUG-22: a space-separated multi-tag add fans out into two concurrent same-stream POSTs returning
// note#id@N and note#id@N+1. They race to the single per-stream token slot; if the older @N lands
// last, the next gated note read releases once only the first tag is folded and drops the second
// tag's pill. The slot must keep the HIGHER version regardless of capture order.
describe('consistency token slot keeps the highest same-stream version (BUG-22)', () => {
  afterEach(() => {
    clearStreamToken(`note#${NOTE_ID}`)
    clearStreamToken(`note#${NOTE_ID_2}`)
    clearLatestToken('noteCards')
    clearLatestToken('scope')
  })

  it('a lower same-stream version captured LAST does not regress the per-stream slot', () => {
    setStreamToken(`note#${NOTE_ID}`, `note#${NOTE_ID}@7`)
    setStreamToken(`note#${NOTE_ID}`, `note#${NOTE_ID}@6`)
    expect(getStreamToken(`note#${NOTE_ID}`)).toBe(`note#${NOTE_ID}@7`)
  })

  it('a genuinely newer same-stream write still advances the per-stream slot', () => {
    setStreamToken(`note#${NOTE_ID}`, `note#${NOTE_ID}@7`)
    setStreamToken(`note#${NOTE_ID}`, `note#${NOTE_ID}@9`)
    expect(getStreamToken(`note#${NOTE_ID}`)).toBe(`note#${NOTE_ID}@9`)
  })

  it('two concurrent tagNote writes leave the higher token in the slot even when the lower resolves last', async () => {
    server.use(
      // token chosen by the tag in the body, so the test controls capture order deterministically
      http.post(`/api/notes/${NOTE_ID}/tags`, async ({ request }) => {
        const { tag } = (await request.json()) as { tag: string }
        const version = tag === 'Bill' ? 7 : 6
        return new HttpResponse(null, { status: 200, headers: { 'X-Consistency-Token': `note#${NOTE_ID}@${version}` } })
      }),
    )

    await tagNote(NOTE_ID, 'Bill') // @7 captured first
    await tagNote(NOTE_ID, '1:1s') // @6 captured last — must NOT win

    expect(getStreamToken(`note#${NOTE_ID}`)).toBe(`note#${NOTE_ID}@7`)
  })

  it('a DIFFERENT-stream write still moves the latest-write pointer regardless of version (design #7)', () => {
    setLatestToken('scope', `note#${NOTE_ID}@9`)
    setLatestToken('scope', `note#${NOTE_ID_2}@2`)
    expect(getLatestToken('scope')).toBe(`note#${NOTE_ID_2}@2`)
  })

  it('a lower same-stream version captured LAST does not regress the latest-write pointer', () => {
    setLatestToken('scope', `note#${NOTE_ID}@7`)
    setLatestToken('scope', `note#${NOTE_ID}@6`)
    expect(getLatestToken('scope')).toBe(`note#${NOTE_ID}@7`)
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
