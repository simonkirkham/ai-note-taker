import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Editor } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import { TaskItem } from '@tiptap/extension-task-item'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { ImageWithResize } from '../components/imageWithResize'
import { createAgendaEditorApi } from '../lib/agendaEditorApi'
import { BlankLineParagraph } from '../lib/blankLineParagraph'
import { MarkdownTaskList } from '../lib/markdownTaskList'

// BUG-76 — the "X / Y" pill and the ticks the user can see must come from the same reading of the
// note body. Since 43-H2 the body is the only source, so the only way they can disagree is the
// server's parse and the editor's live read diverging, and each divergence is a topic the user can
// neither see in the header nor tick from it.
//
// The equivalence is the invariant, so it is pinned as a SHARED fixture rather than as two sets of
// hand-written assertions that can drift apart: tests/Domain.Specs/Projections/
// AgendaParityFixtureSpec.cs asserts the same file against AgendaFromContent.Parse.
//
// BUG-66: every editor built here is destroyed in afterEach. A detached editor left alive keeps
// ProseMirror's DOMObserver timer armed; it fires after vitest tears jsdom down and throws
// `document is not defined` as an unhandled error, red-gating whichever PR is running.
interface FixtureTopic {
  text: string
  checked: boolean
}

interface FixtureCase {
  name: string
  markdown: string
  topics: FixtureTopic[]
  header?: FixtureTopic[]
  divergence?: string
}

// Resolved from the vitest root (web/), not from import.meta.url: under the vmThreads pool the
// module URL is not a file: URL, so fileURLToPath throws at import time and the whole suite fails
// to collect — which reads as "0 tests" rather than as a failure.
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures/agenda-parity.json'), 'utf8'),
) as { cases: FixtureCase[] }

const createdEditors: Editor[] = []

afterEach(() => {
  for (const editor of createdEditors) if (!editor.isDestroyed) editor.destroy()
})

afterAll(() => {
  // Guards the cleanup itself: an empty registry would make the leak check vacuously green.
  expect(createdEditors).not.toHaveLength(0)
  expect(createdEditors.flatMap((e, i) => (e.isDestroyed ? [] : [i]))).toEqual([])
})

// The extension set NoteEditor builds, minus the ones that cannot change what counts as a topic.
// Two of these are NOT optional. Without ImageWithResize an image line parses to something the app
// never produces; without Link a linked topic does, and both are divergences the fixture records —
// they would be untestable, or worse, test a document shape no user can create.
// `link: false` on StarterKit then a separate Link mirrors NoteEditor, which configures its own.
function makeEditor(markdown: string) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false, paragraph: false }),
      BlankLineParagraph,
      Markdown,
      MarkdownTaskList,
      TaskItem.configure({ nested: true }),
      ImageWithResize,
      Link.configure({ protocols: ['http', 'https', 'mailto'] }),
    ],
    content: markdown,
  })
  createdEditors.push(editor)
  return editor
}

describe('the header reads the same agenda the server does (BUG-76)', () => {
  for (const { name, markdown, topics, header } of fixture.cases) {
    it(name, () => {
      expect(createAgendaEditorApi(makeEditor(markdown)).readTopics()).toEqual(header ?? topics)
    })
  }

  it('the register of known divergences is exactly the three that were signed off', () => {
    // Named, not counted: "at least one divergence exists" would let a fourth in behind a rename
    // and a one-word excuse, with both suites still green. Adding a row here is a deliberate act
    // a reviewer sees in the diff. Sorted, so reordering the fixture is not a failure — only the
    // SET is the contract.
    expect(
      fixture.cases
        .filter((c) => c.header !== undefined)
        .map((c) => c.name)
        .sort(),
    ).toEqual([
      'a checklist line holding an image and text (KNOWN DIVERGENCE, open)',
      'a checklist line holding only an image (KNOWN DIVERGENCE, open)',
      'a topic containing a link (KNOWN DIVERGENCE, open)',
    ])
    for (const c of fixture.cases) {
      if (c.header === undefined) continue
      expect(c.divergence ?? '').not.toHaveLength(0)
    }
  })

  it('covers every case in the shared fixture', () => {
    // Both sides iterate whatever `cases` holds, so DELETING a case silently deletes coverage from
    // this suite and from AgendaParityFixtureSpec at once. The count is pinned in both places; it
    // has to be raised deliberately, in the same commit as the case that raises it.
    expect(fixture.cases).toHaveLength(13)
  })
})

// The fixture's header comment keeps two divergences OUT of the register on one ground: the first
// save normalises them away. That claim is the whole justification, and prose in a JSON blob goes
// silently false the day a dependency changes — a tiptap-markdown that stops hoisting, or a
// serializer that stops fencing, would re-open a real count divergence with nothing going red.
// So the claim is asserted, not written down.
describe('the divergences left out of the register really are normalised by a save (BUG-76)', () => {
  const md = (e: Editor) => e.storage.markdown.getMarkdown()

  it('rewrites a numbered task marker to a bullet the server counts', () => {
    const e = makeEditor('1. [ ] Numbered task')

    // The client reads the topic without ever descending a numbered list: the parser leaves the
    // orderedList item empty and hoists a sibling TOP-LEVEL taskList. That is why widening the
    // walk to nested lists does not reach this case.
    expect(createAgendaEditorApi(e).readTopics().map((t) => t.text)).toEqual(['Numbered task'])
    // Saved as `- [ ]`, which the server's [-*+] marker class does match, so the two agree after.
    expect(md(e)).toContain('- [ ] Numbered task')
    expect(md(e)).not.toMatch(/^\s*1\.\s+\[ ]/m)
    // Not lossless: the emptied numbered item survives as a visible `1. ` line. Inert for the
    // agenda (neither side reads it as a topic) but the note is not left as the user wrote it.
    expect(md(e)).toMatch(/^1\.\s*$/m)
  })

  it('re-emits a 4-space-indented code block fenced, so the server stops counting its line', () => {
    const e = makeEditor('    - [ ] Indented code task\n\n- [ ] Real topic')

    expect(createAgendaEditorApi(e).readTopics().map((t) => t.text)).toEqual(['Real topic'])
    // AgendaFromContent's only code rule is a ``` / ~~~ fence — it has no indented-code rule — so
    // the fence is exactly what stops it counting the line inside.
    expect(md(e).indexOf('```')).toBeGreaterThanOrEqual(0)
    expect(md(e).indexOf('```')).toBeLessThan(md(e).indexOf('- [ ] Indented code task'))
  })
})

// The count is only half of it: the header addresses a topic by its index in this same list, so a
// topic the walk newly sees must also be tickable, editable and removable at that index.
describe('a topic the header shows can be acted on at its index (BUG-76)', () => {
  const md = (e: Editor) => e.storage.markdown.getMarkdown()

  it('ticks a checklist item nested under a plain bullet', () => {
    const e = makeEditor('- Shopping\n  - [ ] Milk\n  - [ ] Bread')
    createAgendaEditorApi(e).setTopicChecked(1, true)

    expect(md(e)).toContain('[ ] Milk')
    expect(md(e)).toContain('[x] Bread')
  })

  it('ticks a checklist item two levels down, under a bullet under a task item', () => {
    const e = makeEditor('- [ ] Budget (Q3)\n  - Cloud spend\n    - [ ] Storage tier\n- [ ] Hiring plan')
    createAgendaEditorApi(e).setTopicChecked(1, true)

    expect(md(e)).toContain('[x] Storage tier')
    expect(md(e)).toContain('[ ] Budget (Q3)')
    expect(md(e)).toContain('[ ] Hiring plan')
  })

  it('rewords a checklist item nested under a plain bullet', () => {
    const e = makeEditor('- Shopping\n  - [ ] Milk')
    createAgendaEditorApi(e).setTopicText(0, 'Oat milk')

    expect(md(e)).toContain('[ ] Oat milk')
    expect(md(e)).toContain('Shopping')
  })

  it('removes a checklist item nested under a plain bullet', () => {
    const e = makeEditor('- Shopping\n  - [ ] Milk\n  - [ ] Bread')
    createAgendaEditorApi(e).removeTopic(0)

    expect(md(e)).not.toContain('Milk')
    expect(md(e)).toContain('[ ] Bread')
  })

  it('adds a topic to the nested checklist the header is already showing', () => {
    const e = makeEditor('- Shopping\n  - [ ] Milk')
    createAgendaEditorApi(e).addTopic('Bread')

    expect(createAgendaEditorApi(e).readTopics().map((t) => t.text)).toEqual(['Milk', 'Bread'])
  })

  it('still refuses to add into a blockquoted checklist', () => {
    // A quoted checklist is someone else's agenda: the walk never reads it, so a topic added there
    // would silently never appear. A new top-level list is the right home.
    const e = makeEditor('> - [ ] Quoted topic\n\nRunning prose.')
    createAgendaEditorApi(e).addTopic('Renewals')

    expect(createAgendaEditorApi(e).readTopics().map((t) => t.text)).toEqual(['Renewals'])
    expect(md(e)).toContain('> - [ ] Quoted topic')
  })
})
