// BUG-24: kill the parse-time fetch of an inline image's bare S3 key.
//
// Stored note content carries images as stable bare keys (`![](notes/{id}/{img}.png)` —
// the never-persist-a-presigned-URL invariant in `noteImages.ts`). tiptap-markdown parses
// markdown by rendering it to an HTML string (markdown-it) and assigning that to a detached
// DOMParser document. A bare-key `<img src="notes/…">` in that transient document is fetched
// eagerly by the browser as a URL *relative to the SPA route* → `…/notes/notes/…` → 403,
// before any ProseMirror node / `ImageNodeView` exists (so BUG-19's render-time placeholder
// guard never sees it).
//
// Fix: when markdown-it renders an image whose `src` is a bare key, emit the key in a
// non-`src` `data-image-key` attribute with no `src`, so the parsed HTML has nothing fetchable.
// The node's `parseHTML` reads `data-image-key` back into the `src` attribute, so the
// ProseMirror node still holds the key — `ImageNodeView`'s placeholder, `resolveImages`'
// key→presigned swap, and the serialize-from-`src` save invariant are all unchanged.
//
// Presigned/blob srcs (which only appear *after* an in-editor resolve/upload, never in stored
// markdown reaching this parser) are left as a normal `src` — they are intentionally fetchable.

import { isImageKey } from './noteImages';

export const KEY_DATA_ATTR = 'data-image-key';

// Minimal shape of a markdown-it image token and renderer this helper touches.
interface ImageToken {
  attrs: [string, string][] | null;
  attrIndex(name: string): number;
}
type RenderRule = (
  tokens: ImageToken[],
  idx: number,
  options: unknown,
  env: unknown,
  self: unknown
) => string;
interface MarkdownItRenderer {
  rules: { image?: RenderRule };
  renderToken(tokens: ImageToken[], idx: number, options: unknown): string;
}
export interface MarkdownItLike {
  renderer: MarkdownItRenderer;
}

// Rename a bare-key `src` attr to `data-image-key` on a single image token, in place.
// A non-key src (presigned/blob) or a missing src is left untouched. Returns the token.
export function moveBareKeyOutOfSrc(token: ImageToken): ImageToken {
  if (!token.attrs) return token;
  const srcIndex = token.attrIndex('src');
  if (srcIndex < 0) return token;
  const src = token.attrs[srcIndex][1];
  if (!isImageKey(src)) return token;
  token.attrs[srcIndex] = [KEY_DATA_ATTR, src];
  return token;
}

// tiptap-markdown `parse.setup` hook: wrap markdown-it's image renderer so a bare-key image
// renders with `data-image-key` instead of a fetchable `src`. Idempotent default-rule fallback
// (`renderToken`) covers markdown-it builds without an explicit `rules.image`.
export function installBareKeyImageRule(md: MarkdownItLike): void {
  const previous = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    moveBareKeyOutOfSrc(tokens[idx]);
    return previous
      ? previous(tokens, idx, options, env, self)
      : md.renderer.renderToken(tokens, idx, options);
  };
}
