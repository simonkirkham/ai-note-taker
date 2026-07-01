import { Editor } from '@tiptap/core';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { describe, expect, it } from 'vitest';
import { MarkdownTable } from '../lib/markdownTable';

// Drive markdown -> ProseMirror -> markdown through the *real* extensions, exactly
// as NoteEditor does on load/save. This is the authoritative proof that a GFM table
// survives the round-trip — the 46-A risk being tiptap-markdown's default serializer
// silently dropping column alignment on the first edit-save of any note with a table.
const extensions = [StarterKit, Markdown, MarkdownTable, TableRow, TableHeader, TableCell];

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

describe('GFM table markdown round-trip', () => {
  it('parses a pipe table into a real table (not a collapsed paragraph)', () => {
    const html = renderHtml('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect((html.match(/<td/g) ?? []).length).toBe(2);
    expect((html.match(/<th/g) ?? []).length).toBe(2);
  });

  it('preserves cell content through the round-trip', () => {
    const out = roundTrip('| Fruit | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 10 |');
    for (const cell of ['Fruit', 'Qty', 'Apple', '3', 'Pear', '10']) {
      expect(out).toContain(cell);
    }
    expect(out).toMatch(/\|.*\|/);
  });

  it('preserves per-column alignment markers through the round-trip', () => {
    const out = roundTrip('| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |');
    expect(out).toContain(':---:');
    expect(out).toContain('---:');
    expect(out).toContain(':---');
  });

  it('renders alignment as a per-cell text-align style', () => {
    const html = renderHtml('| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |');
    expect(html).toContain('text-align: center');
    expect(html).toContain('text-align: right');
  });

  it('keeps inline marks inside a cell', () => {
    const md = '| Item | Note |\n| --- | --- |\n| **bold** | a [link](https://x.com) |';
    expect(roundTrip(md)).toBe(md);
  });

  it('escapes a literal pipe inside a cell', () => {
    const md = '| Expr | Result |\n| --- | --- |\n| a \\| b | c |';
    expect(roundTrip(md)).toBe(md);
  });

  it('is idempotent — a second round-trip is a no-op', () => {
    const md = '| Name | Qty | Price |\n| :--- | :---: | ---: |\n| Apple | 3 | 1.20 |';
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
  });

  // A table almost never stands alone in a real note. The serializer renders each
  // cell via renderInline, which clears the pending block-close from the preceding
  // block; if that isn't restored the table's first line glues onto the previous
  // paragraph/heading — invalid GFM that collapses back to a run-on on reload.
  it('keeps a blank line between a preceding paragraph and the table', () => {
    const md = 'Intro paragraph.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps a blank line between a preceding heading and the table', () => {
    const md = '## Results\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps a blank line between the table and following content', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter the table.';
    expect(roundTrip(md)).toBe(md);
  });

  it('separates two back-to-back tables', () => {
    const md =
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | --- |\n| 3 | 4 |';
    expect(roundTrip(md)).toBe(md);
  });

  it('does not throw on a malformed / unbalanced table', () => {
    expect(() => roundTrip('| A | B |\n| --- |\n| 1 |')).not.toThrow();
  });

  it('round-trips a table with an empty cell', () => {
    const md = '| A | B |\n| --- | --- |\n|  | 2 |';
    expect(roundTrip(md)).toBe(md);
  });
});
