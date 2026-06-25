import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { markHeadingDiscussed } from '../lib/headingDiscussed';

// The ✓ "Mark as discussed" tick fires markHeadingDiscussed with only a CARET
// inside the heading (no range selected) — the same selection NoteEditor's
// floating button produces. BUG-37: a bare toggleStrike on a collapsed caret
// only sets a stored mark, leaving the heading text unstruck.
function editorWith(markdown: string): Editor {
  const editor = new Editor({ extensions: [StarterKit.configure({ link: false }), Markdown] });
  editor.commands.setContent(markdown);
  return editor;
}

function md(editor: Editor): string {
  return editor.storage.markdown.getMarkdown();
}

// Put a collapsed caret inside the first node of the given type.
function caretInside(editor: Editor, nodeType: string): void {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === nodeType && node.content.size > 0) {
      pos = p + 1 + Math.min(1, node.content.size - 1); // a couple of chars into the text
      return false;
    }
    return true;
  });
  editor.commands.setTextSelection(pos);
}

describe('markHeadingDiscussed (BUG-37)', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('strikes the whole heading when the cursor is only a caret inside it', () => {
    editor = editorWith('## Budget review');
    caretInside(editor, 'heading');
    markHeadingDiscussed(editor);
    expect(md(editor)).toBe('## ~~Budget review~~');
  });

  it('removes the strike on a second click (toggle off)', () => {
    editor = editorWith('## ~~Budget review~~');
    caretInside(editor, 'heading');
    markHeadingDiscussed(editor);
    expect(md(editor)).toBe('## Budget review');
  });

  it('strikes only the heading text, not the surrounding body', () => {
    editor = editorWith('## Budget review\n\nSome notes');
    caretInside(editor, 'heading');
    markHeadingDiscussed(editor);
    expect(md(editor)).toBe('## ~~Budget review~~\n\nSome notes');
  });
});
