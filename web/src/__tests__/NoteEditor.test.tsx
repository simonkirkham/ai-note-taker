import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NoteEditor from '../components/NoteEditor'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen, waitFor } from '../test/render'

const resolveImages = vi.fn()
vi.mock('../api/notes', () => ({
  resolveImages: (...args: unknown[]) => resolveImages(...args),
  presignUpload: vi.fn(),
}))

// Mounts the real Tiptap editor (NoteView mocks NoteEditor, so its DOM-level
// link hardening must be proven here) and feeds it markdown via the `value`
// prop the same way note content loads in production.
function renderEditor(markdown: string) {
  function Harness() {
    const [value, setValue] = useState(markdown)
    return <NoteEditor noteId="note-1" value={value} onChange={setValue} onBlur={() => {}} />
  }
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  )
}

function anchors() {
  return Array.from(document.querySelectorAll('[data-testid="note-content"] a'))
}

describe('NoteEditor link-scheme hardening', () => {
  it('does not render a javascript: link as a live anchor', async () => {
    renderEditor('Click [me](javascript:alert(1)) now')
    await screen.findByTestId('note-content')
    await waitFor(() =>
      expect(
        anchors().some((a) => (a.getAttribute('href') ?? '').toLowerCase().startsWith('javascript:')),
      ).toBe(false),
    )
  })

  it('does not render a data: link as a live anchor', async () => {
    renderEditor('See [doc](data:text/html,<script>alert(1)</script>) here')
    await screen.findByTestId('note-content')
    await waitFor(() =>
      expect(anchors().some((a) => (a.getAttribute('href') ?? '').toLowerCase().startsWith('data:'))).toBe(false),
    )
  })

  it('rejects a scheme outside the allowlist that the Tiptap default would permit (ftp)', async () => {
    // ftp is in Tiptap's built-in default protocol list; an explicit
    // http/https/mailto allowlist must reject it. This is what fails before
    // the explicit Link config is in place.
    renderEditor('Grab [file](ftp://example.com/x) please')
    await screen.findByTestId('note-content')
    await waitFor(() =>
      expect(anchors().some((a) => (a.getAttribute('href') ?? '').toLowerCase().startsWith('ftp:'))).toBe(false),
    )
  })

  it('preserves an https link with its href intact', async () => {
    renderEditor('Visit [site](https://example.com/page) today')
    await screen.findByTestId('note-content')
    await waitFor(() => {
      const a = anchors().find((el) => (el.getAttribute('href') ?? '').startsWith('https:'))
      expect(a).toBeTruthy()
      expect(a?.getAttribute('href')).toBe('https://example.com/page')
    })
  })

  it('preserves a mailto link with its href intact', async () => {
    renderEditor('Email [us](mailto:team@example.com) anytime')
    await screen.findByTestId('note-content')
    await waitFor(() => {
      const a = anchors().find((el) => (el.getAttribute('href') ?? '').startsWith('mailto:'))
      expect(a).toBeTruthy()
      expect(a?.getAttribute('href')).toBe('mailto:team@example.com')
    })
  })

  it('marks preserved external links rel="noopener noreferrer nofollow"', async () => {
    renderEditor('Visit [site](https://example.com/page) today')
    await screen.findByTestId('note-content')
    await waitFor(() => {
      const a = anchors().find((el) => (el.getAttribute('href') ?? '').startsWith('https:'))
      expect(a).toBeTruthy()
      expect(a?.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    })
  })
})

// BUG-24 (resolve-before-parse): the editor must never be handed a bare S3 key as an
// <img src>, or the browser fetches it relative to the SPA route → 403. jsdom does not
// fetch images, so this proves the *transform/ordering* (no bare-key src ever reaches the
// editor DOM; the resolved presigned URL does) — NOT the absence of a network fetch. The
// authoritative no-fetch proof is the NoteImageJourney E2E.
describe('NoteEditor resolve-before-parse (BUG-24)', () => {
  const KEY = 'notes/note-1/abc123.png'
  const URL = 'https://bucket.s3.amazonaws.com/notes/note-1/abc123.png?X-Amz-Signature=sig'

  function editorImgSrcs() {
    return Array.from(
      document.querySelectorAll<HTMLImageElement>('[data-testid="note-content"] img')
    ).map((img) => img.getAttribute('src') ?? '')
  }

  beforeEach(() => {
    resolveImages.mockReset()
  })
  afterEach(() => {
    resolveImages.mockReset()
  })

  it('never renders the bare key as an <img src> (parser sees no fetchable key)', async () => {
    let resolve: (urls: Record<string, string>) => void = () => {}
    resolveImages.mockReturnValue(new Promise((r) => { resolve = r }))

    renderEditor(`Notes\n\n![](${KEY})`)
    await screen.findByTestId('note-content')

    // Before resolve completes: the placeholder shows, and crucially no <img> carries the
    // bare key as its src (the editor was constructed with the key stripped out).
    await waitFor(() => expect(resolveImages).toHaveBeenCalledWith('note-1', [KEY]))
    expect(editorImgSrcs().some((src) => src.includes(KEY) && !src.includes('X-Amz-'))).toBe(false)

    // After resolve: the presigned URL renders, still never the bare key.
    resolve({ [KEY]: URL })
    await waitFor(() => expect(editorImgSrcs()).toContain(URL))
    expect(editorImgSrcs().some((src) => src === KEY)).toBe(false)
  })

  it('keeps the editor read-only while a resolve is pending, then editable after', async () => {
    let resolve: (urls: Record<string, string>) => void = () => {}
    resolveImages.mockReturnValue(new Promise((r) => { resolve = r }))

    renderEditor(`Notes\n\n![](${KEY})`)
    const content = await screen.findByTestId('note-content')

    // While pending: read-only, so a fast edit-then-save can't persist the stripped content,
    // and the insert-image control is disabled so a programmatic insert can't be wiped by the
    // resolve setContent.
    await waitFor(() => expect(resolveImages).toHaveBeenCalled())
    expect(content.getAttribute('contenteditable')).toBe('false')
    expect(screen.getByTestId('insert-image-button')).toBeDisabled()

    // After resolve: editable again and the insert control re-enabled.
    resolve({ [KEY]: URL })
    await waitFor(() => expect(content.getAttribute('contenteditable')).toBe('true'))
    expect(screen.getByTestId('insert-image-button')).toBeEnabled()
  })

  it('does not call resolveImages for content with no image keys (snappy load)', async () => {
    resolveImages.mockResolvedValue({})
    renderEditor('Plain text only.')
    const content = await screen.findByTestId('note-content')
    expect(content.getAttribute('contenteditable')).toBe('true')
    expect(resolveImages).not.toHaveBeenCalled()
  })
})

// 46-A: a GFM pipe table in note markdown must render as a real grid in the actual
// editor, not collapse to a run-on paragraph. The round-trip test proves the
// extension config; this proves NoteEditor is wired to use it.
describe('NoteEditor GFM tables (46-A)', () => {
  function tableCells() {
    return Array.from(document.querySelectorAll('[data-testid="note-content"] td'))
  }

  it('renders a pipe table as a real grid with separate cells', async () => {
    renderEditor('| Fruit | Qty |\n| --- | --- |\n| Apple | 3 |')
    await screen.findByTestId('note-content')
    await waitFor(() =>
      expect(document.querySelector('[data-testid="note-content"] table')).toBeTruthy(),
    )
    const cellText = tableCells().map((c) => c.textContent)
    expect(cellText).toContain('Apple')
    expect(cellText).toContain('3')
  })

  it('applies per-column alignment to the rendered cells', async () => {
    renderEditor('| L | R |\n| :--- | ---: |\n| a | b |')
    await screen.findByTestId('note-content')
    await waitFor(() => expect(tableCells().length).toBe(2))
    const right = tableCells().find((c) => c.textContent === 'b') as HTMLElement | undefined
    expect((right?.getAttribute('style') ?? '')).toContain('text-align: right')
  })
})
