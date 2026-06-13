import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { retryConfig } from '../api/client'
import { tagNote, untagNote } from '../api/tags'
import { server } from '../test/setup'

// BUG-27: a multi-tag add fans into concurrent same-stream POSTs; persistent optimistic-concurrency
// contention now surfaces as a RETRIABLE 503 (distinct from the duplicate-tag 409 no-op). tagNote /
// untagNote must retry the 503 so the write lands, and throw if it never clears so the optimistic
// mutation rolls back rather than silently dropping the write (the lost-tag flake). A genuine 409
// (duplicate) / 404 (already gone) stays an accepted no-op with no retry.
describe('tag write-contention retry (BUG-27)', () => {
  const saved = { ...retryConfig }
  beforeEach(() => { retryConfig.baseDelayMs = 0; retryConfig.maxDelayMs = 0 })
  afterEach(() => { Object.assign(retryConfig, saved) })

  it('retries a 503 then succeeds, so the write lands', async () => {
    let posts = 0
    server.use(
      http.post('/api/notes/n1/tags', () => {
        posts += 1
        return new HttpResponse(null, { status: posts < 3 ? 503 : 204 })
      }),
    )
    await expect(tagNote('n1', 'a')).resolves.toBeUndefined()
    expect(posts).toBe(3)
  })

  it('throws after persistent 503 so the optimistic add rolls back (never a silent drop)', async () => {
    server.use(http.post('/api/notes/n1/tags', () => new HttpResponse(null, { status: 503 })))
    await expect(tagNote('n1', 'a')).rejects.toThrow()
  })

  it('accepts a duplicate-tag 409 as a no-op without retrying', async () => {
    let posts = 0
    server.use(
      http.post('/api/notes/n1/tags', () => { posts += 1; return new HttpResponse(null, { status: 409 }) }),
    )
    await expect(tagNote('n1', 'a')).resolves.toBeUndefined()
    expect(posts).toBe(1)
  })

  it('untagNote retries a 503 then succeeds', async () => {
    let dels = 0
    server.use(
      http.delete('/api/notes/n1/tags/:tag', () => {
        dels += 1
        return new HttpResponse(null, { status: dels < 2 ? 503 : 204 })
      }),
    )
    await expect(untagNote('n1', 'a')).resolves.toBeUndefined()
    expect(dels).toBe(2)
  })
})
