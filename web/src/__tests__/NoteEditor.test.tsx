import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NoteEditor from '../components/NoteEditor'
import { ToastProvider } from '../components/ToastProvider'
import type { LiveTopic } from '../lib/agendaEditorApi'
import { fireEvent, render, screen, waitFor } from '../test/render'

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

describe('NoteEditor spell check (CHANGE-37)', () => {
  // Without this the pin cannot do the job it exists for: a future Tiptap that ignores or
  // overrides editorProps.attributes.spellcheck would drop the squiggles exactly as
  // silently as before, which is the regression the attribute was added to prevent.
  it('renders the editor with spellcheck enabled', async () => {
    renderEditor('some notes')
    const editor = await screen.findByTestId('note-content')
    expect(editor).toHaveAttribute('spellcheck', 'true')
  })
})

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

// 46-B: task-list markdown must render as clickable checkboxes in the real editor,
// and toggling a checkbox must reach the save path. The round-trip test proves the
// serializer; this proves NoteEditor is wired and the toggle updates the doc.
describe('NoteEditor task lists (46-B)', () => {
  function checkboxes() {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-testid="note-content"] input[type="checkbox"]',
      ),
    )
  }

  it('renders checklist items as checkboxes with no literal brackets', async () => {
    renderEditor('- [ ] buy milk\n- [x] send invoice')
    const content = await screen.findByTestId('note-content')
    await waitFor(() => expect(checkboxes().length).toBe(2))
    expect(content.textContent).not.toContain('[ ]')
    expect(content.textContent).not.toContain('[x]')
    expect(checkboxes()[1].checked).toBe(true)
    expect(checkboxes()[0].checked).toBe(false)
  })

  it('toggles a checkbox and pushes the change to onChange as [x]', async () => {
    let latest = '- [ ] buy milk'
    function Harness() {
      const [value, setValue] = useState('- [ ] buy milk')
      return (
        <NoteEditor
          noteId="note-1"
          value={value}
          onChange={(md) => {
            latest = md
            setValue(md)
          }}
          onBlur={() => {}}
        />
      )
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )
    await screen.findByTestId('note-content')
    await waitFor(() => expect(checkboxes().length).toBe(1))

    fireEvent.click(checkboxes()[0])

    await waitFor(() => expect(latest).toContain('[x]'))
    expect(checkboxes()[0].checked).toBe(true)
  })
})

// 46-C: a :shortcode: in loaded note markdown renders as its emoji glyph. The unit
// test proves the transform; this proves NoteEditor applies it to loaded content.
describe('NoteEditor emoji shortcodes (46-C)', () => {
  it('renders a known shortcode in loaded content as its emoji', async () => {
    renderEditor('Great work :tada:')
    const content = await screen.findByTestId('note-content')
    await waitFor(() => expect(content.textContent).toContain('🎉'))
    expect(content.textContent).not.toContain(':tada:')
  })

  it('leaves an unknown shortcode as literal text', async () => {
    renderEditor('status :not_a_real_code: here')
    const content = await screen.findByTestId('note-content')
    await waitFor(() => expect(content.textContent).toContain('status'))
    expect(content.textContent).toContain(':not_a_real_code:')
  })

  it('does not emojify a shortcode inside inline code', async () => {
    renderEditor('type `:tada:` verbatim')
    const content = await screen.findByTestId('note-content')
    await waitFor(() => expect(content.textContent).toContain(':tada:'))
    expect(content.textContent).not.toContain('🎉')
  })
})

// BUG-76 — the header must offer the topics of the note the user is actually looking at. A note
// containing an image mounts with its image keys stripped (BUG-24), which is a DIFFERENT document
// from the resolved one: a checklist line whose text follows an image reads as a topic while the
// image is missing and stops being one when it returns. If the header were not told, clicking a
// tick would tick a different line, or nothing.
//
// BUG-76 filed this as broken — the resolve applies its content with `emitUpdate: false`, so no
// `update` event fires for the setContent itself. It is NOT broken: `editor.setEditable(true)` on
// the very next line emits `update` unconditionally (@tiptap/core `setEditable(editable,
// emitUpdate = true)`), which republishes. This test pins that, because the dependency is
// incidental — reordering or dropping the setEditable, or a Tiptap change to its default, would
// silently freeze the header on the stripped reading.
describe('NoteEditor republishes the agenda after an image resolve (BUG-76)', () => {
  const KEY = 'notes/note-1/burnup.png'
  const URL = 'https://bucket.s3.amazonaws.com/notes/note-1/burnup.png?X-Amz-Signature=sig'
  const BODY = `- [ ] ![Burn-up chart](${KEY}) Budget\n- [ ] Hiring plan`

  beforeEach(() => {
    resolveImages.mockReset()
  })
  afterEach(() => {
    resolveImages.mockReset()
  })

  it('publishes the topics of the resolved document, not the stripped one', async () => {
    let resolve: (urls: Record<string, string>) => void = () => {}
    resolveImages.mockReturnValue(new Promise((r) => { resolve = r }))
    const published: (LiveTopic[] | null)[] = []

    function Harness() {
      const [value, setValue] = useState(BODY)
      return (
        <NoteEditor
          noteId="note-1"
          value={value}
          onChange={setValue}
          onBlur={() => {}}
          onAgendaTopicsChange={(t) => { published.push(t) }}
        />
      )
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )
    await screen.findByTestId('note-content')
    await waitFor(() => expect(resolveImages).toHaveBeenCalledWith('note-1', [KEY]))

    // With the key stripped the line is plain text, so the header offers two topics.
    await waitFor(() =>
      expect(published.at(-1)).toEqual([
        { text: 'Budget', checked: false },
        { text: 'Hiring plan', checked: false },
      ]),
    )

    resolve({ [KEY]: URL })

    // With the image back the first line is no longer a topic the commands can address. The header
    // must be told, or it keeps offering "Budget" at index 0 — which now resolves to "Hiring plan".
    await waitFor(() =>
      expect(published.at(-1)).toEqual([{ text: 'Hiring plan', checked: false }]),
    )
  })
})
