import { backoffMs, requestVoidWithResponse, sleep } from './client'
import { captureNoteToken } from './notes'

// Agenda writes are a note-aggregate flow, so they share the tag-write contention handling:
// persistent optimistic-concurrency contention surfaces as a retriable 503 (BUG-27), retried a
// bounded number of times so the write lands; on the final attempt 503 throws, rolling the
// optimistic item back rather than leaving a phantom over an unpersisted write. The server-minted
// item id is not read back here — the optimistic add uses a temp id and reconciles to the real ids
// on the next note read (gated by the captured consistency token).
const MAX_CONTENTION_RETRIES = 4

export async function addAgendaItem(noteId: string, text: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= MAX_CONTENTION_RETRIES
    const response = await requestVoidWithResponse(
      `/notes/${noteId}/agenda-items`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      },
      last ? [] : [503],
    )
    if (response.status === 503) { await sleep(backoffMs(attempt + 1)); continue }
    captureNoteToken(noteId, response)
    return
  }
}

// Tick / untick an agenda item (43-B). 404 is accepted as a no-op — toggling an item that was
// concurrently removed matches intent (the onSettled refetch drops it); 503 is retried like the add.
export async function setAgendaItemDiscussed(noteId: string, itemId: string, discussed: boolean): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= MAX_CONTENTION_RETRIES
    const response = await requestVoidWithResponse(
      `/notes/${noteId}/agenda-items/${itemId}/discussed`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ discussed }),
      },
      last ? [404] : [404, 503],
    )
    if (response.status === 503) { await sleep(backoffMs(attempt + 1)); continue }
    captureNoteToken(noteId, response)
    return
  }
}
