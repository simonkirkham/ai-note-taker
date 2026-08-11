import { Editor } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-task-item';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { BlankLineParagraph } from '../lib/blankLineParagraph';
import { ListBlankLineSeparator } from '../lib/listBlankLineSeparator';
import { MarkdownTaskList } from '../lib/markdownTaskList';

// BUG-68's rule rewrites the user's stored note before it is parsed, so the one thing it must
// never do is change text markdown promises to leave literal -- a fenced or indented code block,
// or raw HTML. A separator landing in there is invisible in the editor, permanent once saved,
// and worse than the bug being fixed. Three of the four defects found in review were exactly
// this, each through a different mis-measured threshold, so the guard is asserted on the OUTCOME
// (what reaches a code block) rather than on any one threshold.
//
// The oracle is an A/B through the real editor: the same source parsed with and without the
// rule must produce identical code-block text. That needs no direct markdown-it import, which
// would be a phantom dependency -- and the editor is the actual consumer.
const base = [
  StarterKit.configure({ link: false, paragraph: false }),
  BlankLineParagraph,
  Markdown,
  MarkdownTaskList,
  TaskItem.configure({ nested: true }),
];
const withRule = [...base, ListBlankLineSeparator];

describe('the list separator never rewrites literal text', () => {
  const editors: Editor[] = [];
  afterEach(() => {
    while (editors.length > 0) editors.pop()?.destroy();
  });

  function codeBlocksOf(markdown: string, extensions: typeof base): string[] {
    const editor = new Editor({ extensions, content: markdown });
    editors.push(editor);
    const blocks: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') blocks.push(node.textContent);
    });
    return blocks;
  }

  const sources: [name: string, markdown: string][] = [
    // Round 1 -- an indented code block inside a list item.
    ['yaml under a bullet', '- Config we agreed:\n\n      services:\n        - api\n\n        - worker'],
    ['cli output under a bullet', '- Ran the audit:\n\n      - eslint 9.0.0\n\n      - vite 6.0.0'],
    // Round 2 -- the content column clamped when the marker is padded.
    ['wide marker, five spaces', '-     services:\n\n        - api\n\n        - worker'],
    ['wide marker, six spaces', '-      alpha\n\n         - a\n\n         - b'],
    ['wide ordered marker', '1.     step\n\n         - a\n\n         - b'],
    // Round 3 -- a fence inside a list item, at every depth.
    ['fence six columns deep', '- Steps:\n  - Sub:\n\n      ```\n      - a\n\n      - b\n      ```'],
    ['fence four columns deep', '- Steps:\n\n    ```\n    - a\n\n    - b\n    ```'],
    ['fence two columns deep', '- Steps:\n\n  ```\n  - a\n\n  - b\n  ```'],
    ['tilde fence in an item', '- Steps:\n\n  ~~~\n  - a\n\n  - b\n  ~~~'],
    ['pre block in an item', '- Steps:\n\n  <pre>\n  - a\n\n  - b\n  </pre>'],
    // Round 4 -- the closing fence, the empty item, the container by position.
    ['fence opener with a stray leading space', ' ```\ncode\n    ```\n- a\n\n- b'],
    ['fence in an item with a deeper closer', '- Steps:\n\n     ```\n     code\n      ```\n     - a\n\n     - b'],
    ['an item that is a marker and two spaces', '-  \n      - a\n\n      - b'],
    ['an empty item closed by its blank line', '-\n\n     - a\n\n     - b'],
    ['a padded ordered marker with an under-indented sub-list', '10.   Deploy\n    - check A\n\n    - check B'],
    ['a padded 1. marker with an under-indented sub-list', '1.    step\n    - a\n\n    - b'],
    // Top level, and the shapes that must still be fixed.
    ['fence at top level', '```\n- a\n\n- b\n```'],
    ['a list after a nested fence closes', '- Steps:\n\n  ```\n  code\n  ```\n\n  - a\n\n  - b'],
    ['two bullet lists', '- a\n- b\n\n- c'],
    ['a nested sub-list', '- Install:\n    - npm install\n\n    - npm test'],
    ['the four-space boundary', '-    alpha\n     - a\n\n     - b'],
    ['a blockquoted list', '> - a\n>\n> - b'],
    ['a tab-indented sub-list', '- parent\n\t- a\n\n\t- b'],
  ];

  it.each(sources)('leaves code untouched: %s', (_name, markdown) => {
    expect(codeBlocksOf(markdown, withRule)).toEqual(codeBlocksOf(markdown, base));
  });

  it('the comparison can actually see a separator reaching a code block', () => {
    // Instrument check. Without this the suite above passes just as happily if the comparison is
    // blind -- which is how the first version of this oracle reported a clean run (`getHTML()`
    // serialises U+00A0 as `&nbsp;`, so a naive string test found nothing either way).
    const clean = '- Steps:\n\n      - a\n\n      - b';
    // Exactly what the rule emits: a blank line, the U+00A0 separator at the items' indent,
    // a blank line -- here landing inside the indented code block, which is the defect.
    const corrupted = '- Steps:\n\n      - a\n\n      \u00A0\n\n      - b';
    expect(codeBlocksOf(corrupted, base)).not.toEqual(codeBlocksOf(clean, base));
  });
});
