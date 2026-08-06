import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { TaskItem } from '@tiptap/extension-task-item';
import { MarkdownTaskList } from '../../lib/markdownTaskList';
import { BlankLineParagraph } from '../../lib/blankLineParagraph';
import { AgendaChip, AgendaHeading } from '../prototypeExtensions';
import {
  addTaskItem,
  deleteNodeAt,
  matchAgainstHeadings,
  readChips,
  readHeadings,
  readTaskItems,
  setHeadingAgenda,
  setTaskChecked,
  toggleHeadingStrike,
} from '../agendaVariants';

function makeEditor(content: string, withChip = false) {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false, paragraph: false, heading: false }),
      BlankLineParagraph,
      AgendaHeading,
      Markdown,
      MarkdownTaskList,
      TaskItem.configure({ nested: true }),
      ...(withChip ? [AgendaChip] : []),
    ],
    content,
  });
}

const md = (e: Editor) => (e.storage.markdown as { getMarkdown(): string }).getMarkdown();

describe('prototype — the editor builds and the variant rules read the real doc', () => {
  it('seeds task lines and reads them as agenda items', () => {
    const e = makeEditor('- [ ] Budget (Q3)\n- [ ] Hiring plan\n- [ ] On-call rotation\n\nRunning prose here.');
    const items = readTaskItems(e);
    expect(items.map((i) => i.text)).toEqual(['Budget (Q3)', 'Hiring plan', 'On-call rotation']);
    expect(items.every((i) => !i.done)).toBe(true);
  });

  it('ticking from the header writes - [x] into the markdown and nothing else', () => {
    const e = makeEditor('- [ ] Budget (Q3)\n- [ ] Hiring plan\n\nProse.');
    const before = md(e);
    setTaskChecked(e, readTaskItems(e)[0].pos!, true);
    const after = md(e);

    expect(after).toContain('[x] Budget (Q3)');
    expect(after).toContain('[ ] Hiring plan');
    // The whole point of the chosen design: no hidden identity token appears.
    expect(after).not.toMatch(/<!--/);
    expect(before).not.toEqual(after);
    expect(readTaskItems(e).filter((i) => i.done)).toHaveLength(1);
  });

  it('an item added from the header joins the FIRST task list (Q7)', () => {
    const e = makeEditor('- [ ] Budget (Q3)\n\nProse in the middle.\n\n- [ ] A later list');
    addTaskItem(e, 'On-call rotation');
    const texts = readTaskItems(e).map((i) => i.text);
    expect(texts).toEqual(['Budget (Q3)', 'On-call rotation', 'A later list']);
  });

  it('with no task list at all, a new list is started at the top (Q7)', () => {
    const e = makeEditor('Just running prose, no checkboxes anywhere.');
    addTaskItem(e, 'Budget (Q3)');
    expect(readTaskItems(e).map((i) => i.text)).toEqual(['Budget (Q3)']);
    expect(md(e).indexOf('[ ] Budget')).toBeLessThan(md(e).indexOf('Just running prose'));
  });

  it('removing from the header deletes the body line', () => {
    const e = makeEditor('- [ ] Budget (Q3)\n- [ ] Hiring plan');
    deleteNodeAt(e, readTaskItems(e)[0].pos!);
    expect(readTaskItems(e).map((i) => i.text)).toEqual(['Hiring plan']);
  });

  it('the loose ✓ strikes a whole heading — the deleted markHeadingDiscussed shape', () => {
    const e = makeEditor('## Budget (Q3)\n\nProse.');
    const h = readHeadings(e)[0];
    expect(h.struck).toBe(false);
    toggleHeadingStrike(e, h.pos);
    expect(md(e)).toContain('~~Budget (Q3)~~');
    expect(readHeadings(e)[0].struck).toBe(true);
  });

  it('a linked heading carries an agenda attribute', () => {
    const e = makeEditor('## Budget (Q3)\n\nProse.');
    setHeadingAgenda(e, readHeadings(e)[0].pos, true);
    expect(readHeadings(e)[0].agenda).toBe(true);
  });

  it('name matching goes orphan when either side is reworded', () => {
    const e = makeEditor('## Budget (Q3)\n\nProse.');
    const list = [{ key: 's1', text: 'Budget (Q3)', done: false }];
    expect(matchAgainstHeadings(e, list)[0].orphan).toBeFalsy();

    const reworded = [{ key: 's1', text: 'Q3 budget review', done: false }];
    expect(matchAgainstHeadings(e, reworded)[0].orphan).toBe(true);
  });

  it('a chip is a real inline node and serialises to a token', () => {
    const e = makeEditor('<p>Carried over: <span data-agenda-chip="true"></span> today.</p>', true);
    const chips = readChips(e);
    expect(chips).toHaveLength(1);
    expect(md(e)).toContain('<!--chip-->');
  });
});
