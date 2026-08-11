import { Editor } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-task-item';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { BlankLineParagraph } from '../lib/blankLineParagraph';
import { ListBlankLineSeparator, splitBlankLineSeparatedLists } from '../lib/listBlankLineSeparator';
import { MarkdownTaskList } from '../lib/markdownTaskList';

// BUG-68: a blank line the user left between two bullet lists used to disappear on the first
// open-and-save — CommonMark reads `- a\n- b\n\n- c` as ONE loose list, so the two lists merged
// and every item in them gained a blank line. The next save persisted it, permanently.
// These drive markdown -> ProseMirror -> markdown through NoteEditor's real extension set.
const extensions = [
  StarterKit.configure({ link: false, paragraph: false }),
  BlankLineParagraph,
  Markdown,
  MarkdownTaskList,
  TaskItem.configure({ nested: true }),
  ListBlankLineSeparator,
];

const NBSP = '\u00A0';

describe('list separators survive open-and-save (BUG-68)', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  function open(markdown: string): void {
    editor?.destroy();
    editor = new Editor({ extensions, content: markdown });
  }

  function save(): string {
    return editor.storage.markdown.getMarkdown();
  }

  function blocks(): string[] {
    const names: string[] = [];
    editor.state.doc.forEach((node) => names.push(node.type.name));
    return names;
  }

  it('keeps two blank-line-separated bullet lists as two lists', () => {
    open('- a\n- b\n\n- c');
    expect(blocks()).toEqual(['bulletList', 'paragraph', 'bulletList']);
  });

  it('does not double-space the items of a list that had a blank line after it', () => {
    open('- a\n- b\n\n- c');
    expect(save()).toBe(`- a\n- b\n\n${NBSP}\n\n- c`);
  });

  it('is stable — the saved markdown re-opens and re-saves unchanged', () => {
    open('- a\n- b\n\n- c');
    const first = save();
    open(first);
    expect(save()).toBe(first);
  });

  it('keeps lists separated by more than one blank line apart', () => {
    open('- a\n\n\n- b');
    expect(blocks()).toEqual(['bulletList', 'paragraph', 'bulletList']);
  });

  it('keeps two blank-line-separated ordered lists apart', () => {
    open('1. a\n\n2. b');
    expect(blocks()).toEqual(['orderedList', 'paragraph', 'orderedList']);
  });

  it('keeps two blank-line-separated task lists apart', () => {
    open('- [ ] a\n\n- [x] b');
    expect(blocks()).toEqual(['taskList', 'paragraph', 'taskList']);
  });

  it('keeps a blank line between two nested items at the same depth', () => {
    // The parent item now holds a paragraph, which makes the outer list loose -- markdown has
    // no tight form for an item containing a blank line. The separation itself survives, and
    // the result is stable from here on.
    open('- parent\n  - a\n\n  - b');
    const first = save();
    expect(first).toBe(`- parent\n\n  - a\n\n  ${NBSP}\n\n  - b`);
    open(first);
    expect(save()).toBe(first);
  });

  it('keeps a list that resumes at the outer level after a nested item', () => {
    // The real prod shape: the line before the blank run is a *nested* item, and the item
    // after it re-enters the outer list.
    open('- a\n  - a1\n\n- b');
    expect(blocks()).toEqual(['bulletList', 'paragraph', 'bulletList']);
  });

  it('leaves a list with no blank lines untouched', () => {
    open('- a\n- b\n- c');
    expect(save()).toBe('- a\n- b\n- c');
  });

  it('leaves a genuinely nested list untouched', () => {
    open('- a\n  - a1\n- b');
    expect(save()).toBe('- a\n  - a1\n- b');
  });

  it('leaves an editor-written separator paragraph untouched', () => {
    const md = `- a\n- b\n\n${NBSP}\n\n- c`;
    open(md);
    expect(save()).toBe(md);
  });

  it('keeps every blank line a user left between two lists (BUG-40)', () => {
    const md = `- a\n\n${NBSP}\n\n${NBSP}\n\n${NBSP}\n\n- b`;
    open(md);
    expect(save()).toBe(md);
  });

  it('keeps a list next to prose unchanged', () => {
    const md = 'Intro.\n\n- a\n- b\n\nOutro.';
    open(md);
    expect(save()).toBe(md);
  });
});

describe('splitBlankLineSeparatedLists', () => {
  it('separates two same-marker lists', () => {
    expect(splitBlankLineSeparatedLists('- a\n\n- b')).toBe(`- a\n\n${NBSP}\n\n- b`);
  });

  it('collapses a run of blank lines to a single separator', () => {
    expect(splitBlankLineSeparatedLists('- a\n\n\n\n- b')).toBe(`- a\n\n${NBSP}\n\n- b`);
  });

  it('leaves items at different depths alone', () => {
    expect(splitBlankLineSeparatedLists('- a\n\n  - b')).toBe('- a\n\n  - b');
  });

  it('separates a list resuming at the outer level after a nested item', () => {
    expect(splitBlankLineSeparatedLists('- a\n  - a1\n\n- b')).toBe(
      `- a\n  - a1\n\n${NBSP}\n\n- b`
    );
  });

  it('leaves a blank line after an item continuation paragraph alone', () => {
    const md = '- a\n\n  more about a\n\n- b';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves a different list type alone', () => {
    expect(splitBlankLineSeparatedLists('- a\n\n1. b')).toBe('- a\n\n1. b');
  });

  it('leaves a task list next to a bullet list alone', () => {
    expect(splitBlankLineSeparatedLists('- [ ] a\n\n- b')).toBe('- [ ] a\n\n- b');
    expect(splitBlankLineSeparatedLists('- a\n\n- [x] b')).toBe('- a\n\n- [x] b');
  });

  it('leaves a thematic break between two lists alone', () => {
    expect(splitBlankLineSeparatedLists('- a\n\n- - -\n\n- b')).toBe('- a\n\n- - -\n\n- b');
    expect(splitBlankLineSeparatedLists('* a\n\n* * *\n\n* b')).toBe('* a\n\n* * *\n\n* b');
  });

  it('leaves lists with different bullet characters alone', () => {
    // `- a` then `* b` is already two lists in CommonMark -- no separator needed.
    expect(splitBlankLineSeparatedLists('- a\n\n* b')).toBe('- a\n\n* b');
    expect(splitBlankLineSeparatedLists('+ a\n\n- b')).toBe('+ a\n\n- b');
  });

  it('leaves ordered lists with different delimiters alone', () => {
    expect(splitBlankLineSeparatedLists('1. a\n\n1) b')).toBe('1. a\n\n1) b');
  });

  it('separates ordered lists sharing a delimiter', () => {
    expect(splitBlankLineSeparatedLists('1. a\n\n5. b')).toBe(`1. a\n\n${NBSP}\n\n5. b`);
  });

  it('leaves list-looking lines inside an HTML block alone', () => {
    const md = '<div>\n- a\n\n- b\n</div>';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves a lazy continuation line alone', () => {
    const md = '- a\nlazy continuation\n\n- b';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves a blockquoted list alone', () => {
    const md = '> - a\n>\n> - b';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('handles empty and blank-only input', () => {
    expect(splitBlankLineSeparatedLists('')).toBe('');
    expect(splitBlankLineSeparatedLists('\n\n\n')).toBe('\n\n\n');
  });

  it('does not read a U+00A0 separator line as blank', () => {
    const md = `- a\n\n${NBSP}\n\n${NBSP}\n\n- b`;
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves list-looking lines inside a fenced code block alone', () => {
    const md = '```\n- a\n\n- b\n```';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves list-looking lines inside a tilde-fenced code block alone', () => {
    const md = '~~~\n- a\n\n- b\n~~~';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves list-looking lines inside an indented code block alone', () => {
    const md = 'Sample:\n\n    - a\n\n    - b';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('is idempotent', () => {
    const once = splitBlankLineSeparatedLists('- a\n\n- b');
    expect(splitBlankLineSeparatedLists(once)).toBe(once);
  });

  it('normalises CRLF input without corrupting it', () => {
    expect(splitBlankLineSeparatedLists('- a\r\n\r\n- b')).toBe(`- a\n\n${NBSP}\n\n- b`);
  });
});
