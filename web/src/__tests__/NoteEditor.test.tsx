import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import NoteEditor from '../components/NoteEditor'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen, waitFor } from '../test/render'
import { server } from '../test/setup'

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

describe('NoteEditor parse-time image fetch (BUG-24)', () => {
  const KEY = 'notes/note-1/abc123.png'

  it('parses bare-key content without ever producing a fetchable <img src> for the key', async () => {
    // Hold the resolve open so the assertion runs in the pre-resolve window — the exact
    // window in which BUG-24 fired its relative-URL 403.
    server.use(
      http.post('*/notes/:noteId/images/resolve', () => new Promise<Response>(() => {})),
    )
    renderEditor(`Notes\n\n![](${KEY})`)
    await screen.findByTestId('note-content')

    await waitFor(() => {
      expect(screen.getByTestId('image-placeholder')).toBeInTheDocument()
    })
    const imgs = Array.from(document.querySelectorAll('[data-testid="note-content"] img'))
    expect(imgs.some((img) => (img.getAttribute('src') ?? '').includes(KEY))).toBe(false)
    expect(imgs.length).toBe(0)
  })

  it('swaps in the presigned <img> once resolve returns', async () => {
    const url = 'https://bucket.s3.amazonaws.com/notes/note-1/abc123.png?X-Amz-Signature=z'
    server.use(
      http.post('*/notes/:noteId/images/resolve', () => HttpResponse.json({ urls: { [KEY]: url } })),
    )
    renderEditor(`![](${KEY})`)
    await screen.findByTestId('note-content')

    await waitFor(() => {
      const img = document.querySelector('[data-testid="note-content"] img')
      expect(img?.getAttribute('src')).toBe(url)
    })
  })
})
