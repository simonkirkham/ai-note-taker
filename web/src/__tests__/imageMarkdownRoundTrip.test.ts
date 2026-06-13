import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { describe, expect, it } from 'vitest';
import { ImageWithResize } from '../components/imageWithResize';

// Drive markdown -> ProseMirror -> markdown through the *real* extension, exactly
// as NoteEditor does on load/save. This is the authoritative proof that a `width`
// survives the round-trip (the core 28-A risk: the serializer silently dropping it).
function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), Markdown, ImageWithResize],
    content: markdown,
  });
  const out = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return out.trim();
}

const KEY = 'notes/note-1/abc123.png';

describe('image width markdown round-trip', () => {
  it('preserves a width token in the markdown title slot', () => {
    const out = roundTrip(`![](${KEY} "w=480")`);
    expect(out).toContain(KEY);
    expect(out).toMatch(/"w=480"/);
  });

  it('parses the width into the node and re-serialises it unchanged', () => {
    expect(roundTrip(`![](${KEY} "w=240")`)).toBe(`![](${KEY} "w=240")`);
  });

  it('omits the width token entirely for an unsized image', () => {
    const out = roundTrip(`![](${KEY})`);
    expect(out).toContain(KEY);
    expect(out).not.toContain('w=');
    expect(out).not.toContain('"');
  });

  it('does not leak the width token into the visible title attribute', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), Markdown, ImageWithResize],
      content: `![](${KEY} "w=480")`,
    });
    let widthAttr: unknown;
    let titleAttr: unknown;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') {
        widthAttr = node.attrs.width;
        titleAttr = node.attrs.title;
      }
    });
    editor.destroy();
    expect(widthAttr).toBe(480);
    // The width token must not survive as a real HTML title (it would show as a tooltip).
    expect(titleAttr ?? '').not.toContain('w=');
  });

  it('falls back to natural size for a malformed width token', () => {
    const out = roundTrip(`![](${KEY} "w=notanumber")`);
    expect(out).toContain(KEY);
    expect(out).not.toMatch(/"w=/);
  });
});
