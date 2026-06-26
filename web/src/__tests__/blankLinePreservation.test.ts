import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { BlankLineParagraph } from '../lib/blankLineParagraph';

// BUG-40: a blank line the user leaves between sections (an empty paragraph) used to be
// dropped on save — note content is stored as markdown, whose serializer collapses every
// run of consecutive blank lines / empty paragraphs to a single break. BlankLineParagraph
// serializes an empty paragraph as a non-breaking-space line so the structure survives the
// markdown round-trip. These tests mirror NoteEditor's paragraph + Markdown wiring.
function editorWith(content: string): Editor {
  const editor = new Editor({
    extensions: [StarterKit.configure({ link: false, paragraph: false }), BlankLineParagraph, Markdown],
  });
  editor.commands.setContent(content);
  return editor;
}

function md(editor: Editor): string {
  return editor.storage.markdown.getMarkdown();
}

describe('blank line preservation (BUG-40)', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('keeps a single blank line a user leaves between two paragraphs', () => {
    editor = editorWith('<p>Section A</p><p></p><p>Section B</p>');
    expect(md(editor)).toBe('Section A\n\n\u00A0\n\nSection B');
  });

  it('keeps multiple consecutive blank lines', () => {
    editor = editorWith('<p>A</p><p></p><p></p><p>B</p>');
    expect(md(editor)).toBe('A\n\n\u00A0\n\n\u00A0\n\nB');
  });

  it('round-trips: saved markdown re-loaded then re-saved is unchanged', () => {
    editor = editorWith('<p>Section A</p><p></p><p>Section B</p>');
    const first = md(editor);
    editor.commands.setContent(first);
    expect(md(editor)).toBe(first);
  });

  it('a reloaded blank line is an empty paragraph (no visible character)', () => {
    editor = editorWith('<p>A</p><p></p><p>B</p>');
    editor.commands.setContent(md(editor));
    const paragraphs: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'paragraph') paragraphs.push(n.textContent);
    });
    expect(paragraphs).toEqual(['A', '', 'B']);
  });

  it('leaves ordinary spacing untouched — no stray placeholder in dense content', () => {
    editor = editorWith('<p>A</p><p>B</p>');
    expect(md(editor)).toBe('A\n\nB');
  });

  it('preserves a blank line between a heading and its body', () => {
    editor = editorWith('<h2>Topic</h2><p></p><p>body</p>');
    expect(md(editor)).toBe('## Topic\n\n\u00A0\n\nbody');
  });
});
