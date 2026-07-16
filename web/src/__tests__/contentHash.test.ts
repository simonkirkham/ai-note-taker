import { describe, expect, it } from 'vitest';
import { contentHash } from '../api/contentHash';

// BUG-47: the content hash is a cross-language contract with the .NET server (Domain.Notes.
// NoteContentHash). Both pin the standard SHA-256 test vectors (lower-hex over UTF-8), so a content
// save from the browser and the server's guard can never silently disagree.
describe('contentHash', () => {
  it('hashes empty content to the known SHA-256 of empty', async () => {
    expect(await contentHash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc" to the known SHA-256 of abc', async () => {
    expect(await contentHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
