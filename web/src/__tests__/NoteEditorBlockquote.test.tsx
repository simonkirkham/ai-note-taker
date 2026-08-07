import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import NoteEditor from '../components/NoteEditor'
import { ToastProvider } from '../components/ToastProvider'
import { render, screen } from '../test/render'

vi.mock('../api/notes', () => ({
  resolveImages: vi.fn(),
  presignUpload: vi.fn(),
}))

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

// CHANGE-30's change is CSS, and vitest runs with CSS processing off (no `test.css`
// in vite.config.ts), so jsdom applies no stylesheet and getComputedStyle can prove
// nothing. These two suites guard the two things that *can* fail:
//   1. the DOM the selectors target — if Tiptap stopped nesting `>>` as
//      <blockquote><blockquote>, the nested rule would silently stop matching;
//   2. the rules themselves, and that their colours are theme tokens — a literal
//      colour would look right in the teal theme and wrong in the other 11.
describe('NoteEditor blockquote DOM (CHANGE-30)', () => {
  it('renders a `>` quote as a blockquote inside the editor', async () => {
    renderEditor('> a quoted line')
    const editor = await screen.findByTestId('note-content')
    expect(editor.querySelectorAll('blockquote')).toHaveLength(1)
  })

  it('nests a `>>` quote as a blockquote inside a blockquote', async () => {
    renderEditor('> outer line\n>\n> > inner line')
    const editor = await screen.findByTestId('note-content')
    const nested = editor.querySelectorAll('blockquote blockquote')
    expect(nested).toHaveLength(1)
    expect(nested[0].textContent).toContain('inner line')
  })

  it('nests the tight `>>` form the same way', async () => {
    renderEditor('>> inner line')
    const editor = await screen.findByTestId('note-content')
    expect(editor.querySelectorAll('blockquote blockquote')).toHaveLength(1)
  })

  it('keeps an unquoted paragraph out of any blockquote', async () => {
    renderEditor('just a plain line')
    const editor = await screen.findByTestId('note-content')
    expect(editor.querySelectorAll('blockquote')).toHaveLength(0)
  })
})

describe('NoteEditor blockquote styling (CHANGE-30)', () => {
  // Parse the stylesheet into selector → declarations. Comments are stripped first so a
  // brace-free comment can't be mistaken for a rule; the file has no nested at-rules.
  const rules = new Map(
    readFileSync(resolve(process.cwd(), 'src/components/NoteEditor.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((chunk) => chunk.split('{'))
      .filter((parts) => parts.length === 2)
      .map(([selector, body]) => [selector.trim().replace(/\s+/g, ' '), body.trim()] as const),
  )

  function ruleBody(selector: string): string {
    const body = rules.get(selector)
    expect(body, `no rule for \`${selector}\``).toBeDefined()
    return body!
  }

  it('gives a quote a left bar and muted text', () => {
    const body = ruleBody('.contentInput blockquote')
    expect(body).toMatch(/border-left:\s*\d+px\s+solid\s+var\(--[\w-]+\)/)
    // `(?:^|;)` so the shorthand's own `border-left-color` can't satisfy this.
    expect(body).toMatch(/(?:^|;)\s*color:\s*var\(--[\w-]+\)/m)
  })

  it('distinguishes a nested quote by recolouring its bar', () => {
    const outer = ruleBody('.contentInput blockquote')
    const nested = ruleBody('.contentInput blockquote blockquote')
    expect(nested).toMatch(/border-left-color:\s*var\(--[\w-]+\)/)
    const token = (body: string) => /border-left(?:-color)?:[^;]*var\((--[\w-]+)\)/.exec(body)?.[1]
    expect(token(nested)).not.toBe(token(outer))
  })

  it('uses theme tokens, never a literal colour, so all 12 themes stay consistent', () => {
    for (const selector of ['.contentInput blockquote', '.contentInput blockquote blockquote']) {
      expect(ruleBody(selector)).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
    }
  })
})
