import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { clearStreamToken } from '../api/consistencyTokens';
import { contentHash } from '../api/contentHash';
import { editContent, StaleContentError } from '../api/notes';
import { server } from '../test/setup';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';

afterEach(() => clearStreamToken(`note#${NOTE_ID}`));

// BUG-47: the browser save sends the base-content hash, and a stale-base rejection (409) surfaces as
// a typed StaleContentError the note view can recover from — never a generic failure or a silent
// overwrite.
describe('editContent content-guard wire contract', () => {
  it('sends expectedBaseContentHash in the PUT body', async () => {
    let sentBody: { content: string; expectedBaseContentHash?: string } | null = null;
    server.use(
      http.put(`/api/notes/${NOTE_ID}/content`, async ({ request }) => {
        sentBody = (await request.json()) as typeof sentBody;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const base = await contentHash('the original note');
    await editContent(NOTE_ID, 'the original note, edited', base);

    expect(sentBody).toEqual({ content: 'the original note, edited', expectedBaseContentHash: base });
  });

  it('throws StaleContentError on a 409 stale_content response', async () => {
    server.use(
      http.put(`/api/notes/${NOTE_ID}/content`, () =>
        HttpResponse.json({ error: 'stale_content' }, { status: 409 })),
    );

    await expect(editContent(NOTE_ID, 'fragment', await contentHash(''))).rejects.toBeInstanceOf(
      StaleContentError,
    );
  });

  it('omits the hash when none is supplied (legacy callers unchanged)', async () => {
    let sentBody: { content: string; expectedBaseContentHash?: string } | null = null;
    server.use(
      http.put(`/api/notes/${NOTE_ID}/content`, async ({ request }) => {
        sentBody = (await request.json()) as typeof sentBody;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await editContent(NOTE_ID, 'body');

    expect(sentBody).toEqual({ content: 'body' });
  });
});
