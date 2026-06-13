import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import {
  installBareKeyImageRule,
  KEY_DATA_ATTR,
  type MarkdownItLike,
  moveBareKeyOutOfSrc,
} from '../lib/imageMarkdownParse';

const KEY = 'notes/note-1/abc123.png';
const PRESIGNED =
  'https://bucket.s3.amazonaws.com/notes/note-1/abc123.png?X-Amz-Signature=aaa';
const BLOB = 'blob:http://localhost/9f2c-uuid';

// A bare markdown-it image token, as the renderer rule receives it.
function imageToken(src: string): {
  attrs: [string, string][];
  attrIndex(name: string): number;
} {
  const attrs: [string, string][] = [
    ['src', src],
    ['alt', ''],
  ];
  return { attrs, attrIndex: (n) => attrs.findIndex(([k]) => k === n) };
}

describe('moveBareKeyOutOfSrc', () => {
  it('renames a bare-key src to the data-image-key attr', () => {
    const t = moveBareKeyOutOfSrc(imageToken(KEY));
    expect(t.attrs?.find(([k]) => k === 'src')).toBeUndefined();
    expect(t.attrs?.find(([k]) => k === KEY_DATA_ATTR)?.[1]).toBe(KEY);
  });

  it('leaves a presigned URL src untouched (intentionally fetchable)', () => {
    const t = moveBareKeyOutOfSrc(imageToken(PRESIGNED));
    expect(t.attrs?.find(([k]) => k === 'src')?.[1]).toBe(PRESIGNED);
    expect(t.attrs?.find(([k]) => k === KEY_DATA_ATTR)).toBeUndefined();
  });

  it('leaves a blob upload-preview src untouched', () => {
    const t = moveBareKeyOutOfSrc(imageToken(BLOB));
    expect(t.attrs?.find(([k]) => k === 'src')?.[1]).toBe(BLOB);
  });
});

describe('installBareKeyImageRule — the HTML handed to the Tiptap parser', () => {
  // Baseline: vanilla markdown-it (what tiptap-markdown uses before this fix) renders a
  // bare-key image as a fetchable <img src="notes/…"> — the exact HTML whose DOMParser
  // fetch is the BUG-24 403. The rule below must remove that src.
  it('BASELINE: vanilla markdown-it emits a fetchable bare-key src (the bug)', () => {
    expect(new MarkdownIt().render(`![](${KEY})`)).toContain(`src="${KEY}"`);
  });

  function render(markdown: string): string {
    const md = new MarkdownIt();
    installBareKeyImageRule(md as unknown as MarkdownItLike);
    return md.render(markdown);
  }

  it('emits no fetchable src for a bare-key image (the BUG-24 fetch is killed)', () => {
    const html = render(`![](${KEY})`);
    expect(html).not.toContain(`src="${KEY}"`);
    expect(html).not.toMatch(/<img[^>]*\ssrc=/);
    expect(html).toContain(`${KEY_DATA_ATTR}="${KEY}"`);
  });

  it('preserves the width title token on a bare-key image', () => {
    const html = render(`![](${KEY} "w=240")`);
    expect(html).toContain('title="w=240"');
    expect(html).toContain(`${KEY_DATA_ATTR}="${KEY}"`);
    expect(html).not.toMatch(/<img[^>]*\ssrc=/);
  });

  it('still emits a real src for a presigned URL (resolved image stays loadable)', () => {
    const html = render(`![](${PRESIGNED})`);
    expect(html).toContain(`src="${PRESIGNED}"`);
    expect(html).not.toContain(KEY_DATA_ATTR);
  });

  it('does not touch non-image markdown', () => {
    const html = render(`# Title\n\nPlain [a link](${KEY}) text`);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).not.toContain(KEY_DATA_ATTR);
  });
});
