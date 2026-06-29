import { describe, expect, it } from 'vitest';
import {
  dropUnresolvedImages,
  extractImageKeys,
  extractImageSrcs,
  hasNoImageKeys,
  isImageKey,
  keysToSrcs,
  rewriteImageSrcs,
  srcsToKeys,
  stripImageKeys,
} from '../lib/noteImages';

const KEY_A = 'notes/note-1/abc123.png';
const KEY_B = 'notes/note-1/def456.jpg';
const URL_A =
  'https://bucket.s3.amazonaws.com/notes/note-1/abc123.png?X-Amz-Signature=aaa&Expires=1';
const URL_B =
  'https://bucket.s3.amazonaws.com/notes/note-1/def456.jpg?X-Amz-Signature=bbb&Expires=2';

describe('isImageKey', () => {
  it('accepts a notes/{id}/{img} key', () => {
    expect(isImageKey(KEY_A)).toBe(true);
  });

  it('rejects a presigned URL', () => {
    expect(isImageKey(URL_A)).toBe(false);
  });

  it('rejects an unrelated src', () => {
    expect(isImageKey('https://example.com/cat.png')).toBe(false);
    expect(isImageKey('blob:http://localhost/uuid')).toBe(false);
  });
});

describe('extractImageKeys / extractImageSrcs', () => {
  it('extracts keys from image markdown', () => {
    const md = `Some text\n\n![](${KEY_A})\n\nmore\n\n![alt](${KEY_B})`;
    expect(extractImageKeys(md)).toEqual([KEY_A, KEY_B]);
  });

  it('returns presigned URLs from extractImageSrcs but not from extractImageKeys', () => {
    const md = `![](${URL_A})`;
    expect(extractImageSrcs(md)).toEqual([URL_A]);
    expect(extractImageKeys(md)).toEqual([]);
  });

  it('deduplicates repeated srcs', () => {
    const md = `![](${KEY_A})\n\n![](${KEY_A})`;
    expect(extractImageKeys(md)).toEqual([KEY_A]);
  });

  it('ignores plain links (only matches images)', () => {
    const md = `[a link](${KEY_A})`;
    expect(extractImageKeys(md)).toEqual([]);
  });

  it('returns nothing for content with no images', () => {
    expect(extractImageKeys('# Heading\n\nplain text')).toEqual([]);
  });
});

describe('rewriteImageSrcs', () => {
  it('rewrites a mapped src and preserves alt text', () => {
    const md = `![my screenshot](${KEY_A})`;
    expect(rewriteImageSrcs(md, { [KEY_A]: URL_A })).toBe(`![my screenshot](${URL_A})`);
  });

  it('leaves an unmapped src untouched', () => {
    const md = `![](${KEY_A})`;
    expect(rewriteImageSrcs(md, { [KEY_B]: URL_B })).toBe(md);
  });

  it('rewrites multiple images independently', () => {
    const md = `![](${KEY_A})\n\n![](${KEY_B})`;
    const out = rewriteImageSrcs(md, { [KEY_A]: URL_A, [KEY_B]: URL_B });
    expect(out).toBe(`![](${URL_A})\n\n![](${URL_B})`);
  });

  it('preserves a markdown title attribute', () => {
    const md = `![alt](${KEY_A} "a title")`;
    expect(rewriteImageSrcs(md, { [KEY_A]: URL_A })).toBe(`![alt](${URL_A} "a title")`);
  });

  it('does not touch non-image content', () => {
    const md = `# Heading\n\nParagraph with [a link](${KEY_A}) and \`code\`.`;
    expect(rewriteImageSrcs(md, { [KEY_A]: URL_A })).toBe(md);
  });
});

describe('dropUnresolvedImages', () => {
  it('drops a blob: object-URL image (upload still in flight)', () => {
    const md = `Notes\n\n![](blob:http://localhost/uuid)\n\nmore`;
    expect(dropUnresolvedImages(md)).toBe('Notes\n\n\n\nmore');
  });

  it('drops a leftover presigned URL image', () => {
    expect(dropUnresolvedImages(`![](${URL_A})`)).toBe('');
  });

  it('keeps an image whose src is a stable key', () => {
    const md = `![alt](${KEY_A})`;
    expect(dropUnresolvedImages(md)).toBe(md);
  });

  it('keeps key images and drops transient ones in mixed content', () => {
    const md = `![](${KEY_A}) and ![](blob:http://localhost/x) and ![](${KEY_B})`;
    const out = dropUnresolvedImages(md);
    expect(out).toContain(KEY_A);
    expect(out).toContain(KEY_B);
    expect(out).not.toContain('blob:');
  });

  it('leaves plain links and text untouched', () => {
    const md = `[a link](${KEY_A})\n\ntext`;
    expect(dropUnresolvedImages(md)).toBe(md);
  });
});

describe('round-trip and never-persist-presigned invariant', () => {
  it('keysToSrcs then srcsToKeys restores the original content', () => {
    const original = `Notes\n\n![one](${KEY_A})\n\nmid\n\n![two](${KEY_B})`;
    const urlByKey = { [KEY_A]: URL_A, [KEY_B]: URL_B };

    const displayed = keysToSrcs(original, urlByKey);
    expect(displayed).toContain(URL_A);
    expect(displayed).toContain(URL_B);

    const saved = srcsToKeys(displayed, { [URL_A]: KEY_A, [URL_B]: KEY_B });
    expect(saved).toBe(original);
  });

  it('srcsToKeys never leaves a presigned URL in the saved content', () => {
    const displayed = `![](${URL_A})\n\n![](${URL_B})`;
    const keyByUrl = { [URL_A]: KEY_A, [URL_B]: KEY_B };

    const saved = srcsToKeys(displayed, keyByUrl);

    expect(saved).not.toContain('X-Amz-Signature');
    expect(saved).not.toContain('https://');
    expect(extractImageKeys(saved)).toEqual([KEY_A, KEY_B]);
  });

  it('srcsToKeys also rewrites a blob object-URL preview to its key', () => {
    const blob = 'blob:http://localhost/9f2c-uuid';
    const displayed = `![](${blob})`;
    const saved = srcsToKeys(displayed, { [blob]: KEY_A });
    expect(saved).toBe(`![](${KEY_A})`);
    expect(saved).not.toContain('blob:');
  });
});

// 28-A: a sized image carries its width in the markdown title slot (`"w=<px>"`).
// The helpers swap only the src; the title slot must ride through every swap
// byte-for-byte, or a resized image loses its size on the next save/resolve.
describe('width token (title slot) survives the key <-> URL pipeline', () => {
  it('keysToSrcs preserves the width token when swapping key -> URL', () => {
    const md = `![](${KEY_A} "w=480")`;
    expect(keysToSrcs(md, { [KEY_A]: URL_A })).toBe(`![](${URL_A} "w=480")`);
  });

  it('srcsToKeys preserves the width token when swapping URL -> key', () => {
    const md = `![](${URL_A} "w=480")`;
    expect(srcsToKeys(md, { [URL_A]: KEY_A })).toBe(`![](${KEY_A} "w=480")`);
  });

  it('round-trips a sized image and never persists the presigned URL', () => {
    const original = `![one](${KEY_A} "w=240")\n\n![two](${KEY_B} "w=720")`;
    const displayed = keysToSrcs(original, { [KEY_A]: URL_A, [KEY_B]: URL_B });
    const saved = srcsToKeys(displayed, { [URL_A]: KEY_A, [URL_B]: KEY_B });
    expect(saved).toBe(original);
    expect(saved).not.toContain('X-Amz-Signature');
  });

  it('extractImageKeys ignores the width token (still returns the bare key)', () => {
    expect(extractImageKeys(`![](${KEY_A} "w=480")`)).toEqual([KEY_A]);
  });

  it('dropUnresolvedImages keeps a sized key image and persists no width for a dropped one', () => {
    const md = `![](${KEY_A} "w=480")\n\n![](blob:http://localhost/x "w=300")`;
    const out = dropUnresolvedImages(md);
    expect(out).toContain(`![](${KEY_A} "w=480")`);
    expect(out).not.toContain('blob:');
    expect(out).not.toContain('w=300');
  });
});

// BUG-24: the markdown handed to the Tiptap parser must never contain a bare-key
// image src, or the browser fetches it relative to the SPA route -> 403. These
// prove the resolve-before-parse transform at the pure data seam; jsdom does not
// fetch images, so the authoritative no-fetch proof is the NoteImageJourney E2E.
describe('stripImageKeys (BUG-24 load guard)', () => {
  it('drops a bare-key image so no fetchable src reaches the parser', () => {
    const out = stripImageKeys(`hello\n\n![](${KEY_A})\n\nworld`);
    expect(out).not.toContain(KEY_A);
    expect(hasNoImageKeys(out)).toBe(true);
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('drops a sized bare-key image (width token and all)', () => {
    const out = stripImageKeys(`![](${KEY_A} "w=480")`);
    expect(out).not.toContain(KEY_A);
    expect(out).not.toContain('w=480');
  });

  it('drops every bare-key image, leaving non-key srcs untouched', () => {
    const md = `![](${KEY_A})\n\n![alt](https://cdn.example.com/cat.png)\n\n![](${KEY_B})`;
    const out = stripImageKeys(md);
    expect(hasNoImageKeys(out)).toBe(true);
    expect(out).toContain('https://cdn.example.com/cat.png');
    expect(out).not.toContain(KEY_A);
    expect(out).not.toContain(KEY_B);
  });

  it('leaves a presigned URL image in place (already safe to parse)', () => {
    const out = stripImageKeys(`![](${URL_A})`);
    expect(out).toContain(URL_A);
    expect(hasNoImageKeys(out)).toBe(true);
  });

  it('is a no-op for content with no images', () => {
    expect(stripImageKeys('just some **text**')).toBe('just some **text**');
  });
});

describe('hasNoImageKeys', () => {
  it('is false when a bare key is present', () => {
    expect(hasNoImageKeys(`![](${KEY_A})`)).toBe(false);
  });

  it('is true for presigned URLs and plain text', () => {
    expect(hasNoImageKeys(`![](${URL_A})`)).toBe(true);
    expect(hasNoImageKeys('no images here')).toBe(true);
  });
});

describe('resolve-before-parse content invariant (BUG-24)', () => {
  // The two strings NoteEditor ever hands the parser: the initial content
  // (stripImageKeys) and the resolved content (keysToSrcs after resolve). Both
  // must satisfy hasNoImageKeys; the resolved one must round-trip back to keys.
  const value = `![](${KEY_A} "w=240")\n\ntext\n\n![](${KEY_B})`;

  it('initial content handed to the parser has no bare-key src', () => {
    expect(hasNoImageKeys(stripImageKeys(value))).toBe(true);
  });

  it('resolved content handed to setContent has no bare-key src', () => {
    const resolved = keysToSrcs(value, { [KEY_A]: URL_A, [KEY_B]: URL_B });
    expect(hasNoImageKeys(resolved)).toBe(true);
    expect(resolved).toContain(URL_A);
    expect(resolved).toContain(URL_B);
  });

  it('saving the resolved content serializes back to the bare keys (round-trip)', () => {
    const resolved = keysToSrcs(value, { [KEY_A]: URL_A, [KEY_B]: URL_B });
    const saved = srcsToKeys(resolved, { [URL_A]: KEY_A, [URL_B]: KEY_B });
    expect(saved).toBe(value);
  });
});
