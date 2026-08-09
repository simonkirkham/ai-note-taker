import { Editor } from '@tiptap/core'
import { TaskItem } from '@tiptap/extension-task-item'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { createAgendaEditorApi } from '../lib/agendaEditorApi'
import { BlankLineParagraph } from '../lib/blankLineParagraph'
import { MarkdownTaskList } from '../lib/markdownTaskList'

// Phase 43-G: the header agenda writes back into the note body. These drive a REAL Tiptap editor
// with the same extension set NoteEditor builds, because the whole point of the slice is that a
// header action is an editor transaction — asserting against a stub would prove nothing about
// undo, cursor position, or how the change reaches the markdown.
function makeEditor(markdown: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false, paragraph: false }),
      BlankLineParagraph,
      Markdown,
      MarkdownTaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: markdown,
  })
}

const md = (e: Editor) => (e.storage.markdown).getMarkdown()

describe('agendaEditorApi', () => {
  // What counts as a topic must match AgendaFromContent on the server, which
  // AgendaFromBodySpec pins. A divergence here does not corrupt anything (both the header and the
  // commands use this same walk) but it silently drops or adds topics the user can see.
  describe('what counts as a topic', () => {
    it('counts nested items, flattened into document order', () => {
      const e = makeEditor('- [ ] Budget (Q3)\n  - [ ] Cloud spend\n- [ ] Hiring plan')
      expect(createAgendaEditorApi(e).readTopics().map((t) => t.text)).toEqual([
        'Budget (Q3)',
        'Cloud spend',
        'Hiring plan',
      ])
    })

    it('addresses a nested topic by its flattened index', () => {
      const e = makeEditor('- [ ] Budget (Q3)\n  - [ ] Cloud spend\n- [ ] Hiring plan')
      createAgendaEditorApi(e).setTopicChecked(1, true)

      const topics = createAgendaEditorApi(e).readTopics()
      expect(topics[1]).toEqual({ text: 'Cloud spend', checked: true })
      expect(topics[0].checked).toBe(false)
      expect(topics[2].checked).toBe(false)
    })

    it('skips an empty item, so a freshly-pressed line does not shift the indices', () => {
      const e = makeEditor('- [ ] Budget (Q3)\n- [ ] \n- [ ] Hiring plan')
      expect(createAgendaEditorApi(e).readTopics().map((t) => t.text)).toEqual([
        'Budget (Q3)',
        'Hiring plan',
      ])
    })

    it('reads the ticked state per item', () => {
      const e = makeEditor('- [x] Budget (Q3)\n- [ ] Hiring plan')
      expect(createAgendaEditorApi(e).readTopics()).toEqual([
        { text: 'Budget (Q3)', checked: true },
        { text: 'Hiring plan', checked: false },
      ])
    })
  })

  describe('addTopic', () => {
    it('appends to the first checklist in the note', () => {
      const e = makeEditor('- [ ] Budget (Q3)\n\nRunning prose here.\n\n- [ ] A later list')
      createAgendaEditorApi(e).addTopic('On-call rotation')

      expect(md(e)).toContain('[ ] Budget (Q3)')
      expect(md(e)).toContain('[ ] On-call rotation')
      // It joins the FIRST list, so it appears before the prose, not at the end of the note.
      expect(md(e).indexOf('On-call rotation')).toBeLessThan(md(e).indexOf('Running prose here.'))
    })

    it('starts a checklist at the top when the note has none', () => {
      const e = makeEditor('Just running prose, no checkboxes anywhere.')
      createAgendaEditorApi(e).addTopic('Budget (Q3)')

      const text = md(e)
      expect(text).toContain('[ ] Budget (Q3)')
      expect(text.indexOf('Budget (Q3)')).toBeLessThan(text.indexOf('Just running prose'))
    })

    it('ignores blank text', () => {
      const e = makeEditor('- [ ] Budget (Q3)')
      const before = md(e)
      createAgendaEditorApi(e).addTopic('   ')
      expect(md(e)).toEqual(before)
    })

    it('trims the text it inserts', () => {
      const e = makeEditor('Prose.')
      createAgendaEditorApi(e).addTopic('  Renewals  ')
      expect(md(e)).toContain('[ ] Renewals')
      expect(md(e)).not.toContain('  Renewals')
    })
  })

  describe('setTopicChecked', () => {
    it('ticks the topic at the given position', () => {
      const e = makeEditor('- [ ] Budget (Q3)\n- [ ] Hiring plan')
      createAgendaEditorApi(e).setTopicChecked(1, true)

      expect(md(e)).toContain('[ ] Budget (Q3)')
      expect(md(e)).toContain('[x] Hiring plan')
    })

    it('unticks', () => {
      const e = makeEditor('- [x] Budget (Q3)')
      createAgendaEditorApi(e).setTopicChecked(0, false)
      expect(md(e)).toContain('[ ] Budget (Q3)')
    })

    it('is a no-op for a position that does not exist', () => {
      const e = makeEditor('- [ ] Budget (Q3)')
      const before = md(e)
      createAgendaEditorApi(e).setTopicChecked(7, true)
      expect(md(e)).toEqual(before)
    })
  })

  describe('setTopicText', () => {
    it('rewords the topic without changing its ticked state', () => {
      const e = makeEditor('- [x] Budget (Q3)\n- [ ] Hiring plan')
      createAgendaEditorApi(e).setTopicText(0, 'Q3 budget review')

      expect(md(e)).toContain('[x] Q3 budget review')
      expect(md(e)).toContain('[ ] Hiring plan')
      expect(md(e)).not.toContain('Budget (Q3)')
    })

    it('ignores blank text', () => {
      const e = makeEditor('- [ ] Budget (Q3)')
      const before = md(e)
      createAgendaEditorApi(e).setTopicText(0, '  ')
      expect(md(e)).toEqual(before)
    })
  })

  describe('removeTopic', () => {
    it('deletes the line from the note', () => {
      const e = makeEditor('- [ ] Budget (Q3)\n- [ ] Hiring plan')
      createAgendaEditorApi(e).removeTopic(0)

      expect(md(e)).not.toContain('Budget (Q3)')
      expect(md(e)).toContain('[ ] Hiring plan')
    })

    it('leaves the surrounding prose alone', () => {
      const e = makeEditor('- [ ] Budget (Q3)\n\nRob says cloud spend is 8% over.')
      createAgendaEditorApi(e).removeTopic(0)

      expect(md(e)).not.toContain('Budget (Q3)')
      expect(md(e)).toContain('Rob says cloud spend is 8% over.')
    })
  })

  // The acceptance criterion that makes this slice worth doing as transactions rather than API
  // calls: a header action is undoable exactly like typing.
  describe('undo', () => {
    it('Ctrl+Z brings back a removed topic', () => {
      const e = makeEditor('- [ ] Budget (Q3)\n- [ ] Hiring plan')
      createAgendaEditorApi(e).removeTopic(0)
      expect(md(e)).not.toContain('Budget (Q3)')

      e.commands.undo()

      expect(md(e)).toContain('[ ] Budget (Q3)')
      expect(md(e)).toContain('[ ] Hiring plan')
    })

    it('Ctrl+Z undoes an added topic', () => {
      const e = makeEditor('- [ ] Budget (Q3)')
      createAgendaEditorApi(e).addTopic('Renewals')
      expect(md(e)).toContain('Renewals')

      e.commands.undo()

      expect(md(e)).not.toContain('Renewals')
      expect(md(e)).toContain('[ ] Budget (Q3)')
    })
  })

  // The risky part of the slice (phase-43.md): a header action must apply to the editor's CURRENT
  // document — which holds unsaved typing — and never to the last-saved server copy.
  describe('unsaved typing', () => {
    it('a header action preserves text typed but not yet saved', () => {
      const e = makeEditor('- [ ] Budget (Q3)')
      // Simulate the user typing into the body without the note having been saved.
      e.commands.focus('end')
      e.commands.insertContent('\n\nUnsaved thought about the budget.')
      expect(md(e)).toContain('Unsaved thought about the budget.')

      createAgendaEditorApi(e).addTopic('Renewals')

      expect(md(e)).toContain('Unsaved thought about the budget.')
      expect(md(e)).toContain('[ ] Renewals')
    })

    it('ticking from the header preserves unsaved typing', () => {
      const e = makeEditor('- [ ] Budget (Q3)')
      e.commands.focus('end')
      e.commands.insertContent('\n\nStill typing this.')

      createAgendaEditorApi(e).setTopicChecked(0, true)

      expect(md(e)).toContain('Still typing this.')
      expect(md(e)).toContain('[x] Budget (Q3)')
    })
  })
})
