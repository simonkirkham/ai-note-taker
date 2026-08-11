import { Editor } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-task-item';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { BlankLineParagraph } from '../lib/blankLineParagraph';
import {
  ListBlankLineSeparator,
  RULE_NAME,
  registerListSeparatorRule,
  splitBlankLineSeparatedLists,
  type MarkdownItLike,
} from '../lib/listBlankLineSeparator';
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
  let editor: Editor | undefined;
  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  function open(markdown: string): void {
    editor?.destroy();
    editor = new Editor({ extensions, content: markdown });
  }

  function save(): string {
    if (!editor) throw new Error('open() first');
    return editor.storage.markdown.getMarkdown();
  }

  function blocks(): string[] {
    if (!editor) throw new Error('open() first');
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

  it('leaves an indented code block inside a list item untouched (Hawk must-fix)', () => {
    // The code threshold inside an item is its CONTENT column + 4, not an absolute 4. YAML
    // under a bullet is ordinary note content, and markdown promises code is left literal.
    const md = '- Config we agreed:\n\n      services:\n        - api\n\n        - worker';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves CLI output indented under a list item untouched', () => {
    const md = '- Ran the audit:\n\n      - eslint 9.0.0\n\n      - vite 6.0.0';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves an indented code block inside an ordered item untouched', () => {
    const md = '1. Ran it:\n\n       - one\n\n       - two';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('still separates a genuinely nested sub-list, which is not code', () => {
    // Four columns in, but only two past the parent's content column -- list structure.
    expect(splitBlankLineSeparatedLists('- Install:\n    - npm install\n\n    - npm test')).toBe(
      `- Install:\n    - npm install\n\n    ${NBSP}\n\n    - npm test`
    );
  });

  it('leaves a setext H2 underline alone', () => {
    const md = 'Some text\n-\n\n- b';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
    expect(splitBlankLineSeparatedLists('Release plan\n-\n\n- ship it')).toBe(
      'Release plan\n-\n\n- ship it'
    );
  });

  it('leaves an ordered item that cannot interrupt a paragraph alone', () => {
    const md = 'Release plan\n2. ship it\n\n2. tell people';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('still reads an ordinary ordered list, whose items follow each other', () => {
    // The interruption rule is about paragraphs, never about two sibling items.
    expect(splitBlankLineSeparatedLists('1. a\n2. b')).toBe('1. a\n2. b');
    expect(splitBlankLineSeparatedLists('1. a\n2. b\n\n3. c')).toBe(
      `1. a\n2. b\n\n${NBSP}\n\n3. c`
    );
  });

  it('leaves list-looking lines inside an HTML comment alone', () => {
    const md = '<!--\n- a\n\n- b\n-->';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves list-looking lines inside a <pre> block alone', () => {
    const md = '<pre>\n\n- a\n\n- b\n</pre>';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves list-looking lines inside a <script> block alone', () => {
    const md = '<script>\n- a\n\n- b\n</script>';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('leaves a code block inside a wide-marker item untouched (Hawk round 2)', () => {
    // CommonMark clamps the content column when the marker is followed by 5+ spaces: the item's
    // content already IS code, so the threshold must not follow the text out to column 6.
    const md = '-     services:\n\n        - api\n\n        - worker';
    expect(splitBlankLineSeparatedLists(md)).toBe(md);
  });

  it('clamps the content column for every wide-marker form', () => {
    for (const md of [
      '-      alpha\n\n         - a\n\n         - b',
      '*     alpha\n\n        - a\n\n        - b',
      '1.     step\n\n         - a\n\n         - b',
    ]) {
      expect(splitBlankLineSeparatedLists(md)).toBe(md);
    }
  });

  it('still separates at the four-space boundary, which is a nested list not code', () => {
    // Four spaces after the marker is the last width that is NOT code, so these must still fire.
    expect(splitBlankLineSeparatedLists('-    alpha\n     - a\n\n     - b')).toBe(
      `-    alpha\n     - a\n\n     ${NBSP}\n\n     - b`
    );
    expect(splitBlankLineSeparatedLists('1.    step\n      - a\n\n      - b')).toBe(
      `1.    step\n      - a\n\n      ${NBSP}\n\n      - b`
    );
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

describe('registerListSeparatorRule', () => {
  function fakeMarkdownIt(): { md: MarkdownItLike; registered: string[] } {
    const registered: string[] = [];
    const md: MarkdownItLike = {
      core: { ruler: { after: (_after, name) => registered.push(name) } },
    };
    return { md, registered };
  }

  it('registers the rule once per markdown-it instance', () => {
    // tiptap-markdown calls parse.setup on EVERY parse; without the guard the ruler would grow
    // an extra copy of the rule on each one.
    const { md, registered } = fakeMarkdownIt();
    registerListSeparatorRule(md);
    registerListSeparatorRule(md);
    registerListSeparatorRule(md);
    expect(registered).toEqual([RULE_NAME]);
  });

  it('registers separately for a second instance', () => {
    const first = fakeMarkdownIt();
    const second = fakeMarkdownIt();
    registerListSeparatorRule(first.md);
    registerListSeparatorRule(second.md);
    expect(first.registered).toEqual([RULE_NAME]);
    expect(second.registered).toEqual([RULE_NAME]);
  });

  it('degrades to no separator rather than throwing inside the parse', () => {
    // ruler.after throws if markdown-it ever drops `normalize`. Throwing here would take the
    // whole note down; losing the separator only reinstates BUG-68, which is recoverable.
    const md: MarkdownItLike = {
      core: {
        ruler: {
          after: () => {
            throw new Error('no such rule: normalize');
          },
        },
      },
    };
    expect(() => registerListSeparatorRule(md)).not.toThrow();
  });
});
