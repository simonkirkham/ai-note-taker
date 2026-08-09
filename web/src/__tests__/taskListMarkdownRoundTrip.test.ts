import { Editor } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-task-item';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { describe, expect, it } from 'vitest';
import { MarkdownTaskList } from '../lib/markdownTaskList';

// Drive markdown -> ProseMirror -> markdown through the real extensions, exactly as
// NoteEditor does on load/save. The 46-B risk: tiptap-markdown serialises task lists
// "loose" (a blank line between items), silently double-spacing every checklist on
// the first edit-save. MarkdownTaskList forces a tight list to match bulletList.
const extensions = [StarterKit, Markdown, MarkdownTaskList, TaskItem.configure({ nested: true })];

function roundTrip(markdown: string): string {
  const editor = new Editor({ extensions, content: markdown });
  const out = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return out.trim();
}

function renderHtml(markdown: string): string {
  const editor = new Editor({ extensions, content: markdown });
  const html = editor.getHTML();
  editor.destroy();
  return html;
}

describe('GFM task-list markdown round-trip', () => {
  it('renders task items as checkboxes, not literal brackets', () => {
    const html = renderHtml('- [ ] buy milk\n- [x] send invoice');
    expect(html).toContain('data-type="taskList"');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('[ ]');
    expect(html).not.toContain('[x]');
  });

  it('preserves the checked state of each item', () => {
    const html = renderHtml('- [ ] open\n- [x] done');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-checked="true"');
    // the checked item's input carries the checked attribute
    expect(html).toMatch(/data-checked="true"[\s\S]*?checkbox" checked/);
  });

  it('round-trips a flat task list tight (no blank line between items)', () => {
    const md = '- [ ] a\n- [x] b';
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips checked/unchecked markers', () => {
    const md = '- [x] done\n- [ ] todo';
    expect(roundTrip(md)).toBe(md);
  });

  it('indents and round-trips a nested task list', () => {
    const md = '- [ ] parent\n  - [ ] child\n- [x] sibling';
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps blank lines around a task list embedded in prose', () => {
    const md = 'Intro line.\n\n- [ ] a\n- [x] b\n\nOutro line.';
    expect(roundTrip(md)).toBe(md);
  });

  it('is idempotent — a second round-trip is a no-op', () => {
    const md = '- [ ] a\n  - [x] a1\n- [ ] b';
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
  });

  // 43-H1 writes `checklist + "\n\n" + existing body` into real notes. The review's worry was that
  // a body opening with its OWN bullet list would absorb the checklist into one list (CommonMark
  // merges same-marker lists across a blank line), reformatting the user's content. It does not:
  // the task items parse as a taskList node and the plain items as a separate bulletList, so both
  // survive as themselves. One of the 8 migrated notes has exactly this shape.
  it('keeps a prepended checklist separate from a body that opens with a bullet list', () => {
    const md = '- [ ] How are the teams settling?\n- [x] Any blockers?\n\n- Team settling\n- Backlog in place';

    expect(roundTrip(md)).toBe(md);
    const html = renderHtml(md);
    expect(html).toContain('data-type="taskList"');
    // The body's own bullets stay plain bullets — only the two topics are checkboxes.
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
  });
});
