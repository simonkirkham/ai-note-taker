// Pure helpers for the image key <-> presigned-URL rewrite in note content.
//
// Invariant: persisted markdown must contain only stable S3 keys, never a
// presigned (expiring) URL. `srcsToKeys` enforces this before every save;
// `keysToSrcs` is the inverse applied for display after a resolve.

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

const NOTE_IMAGE_KEY = /^notes\/[^/]+\/[^/]+$/;

export function isImageKey(src: string): boolean {
  return NOTE_IMAGE_KEY.test(src);
}

// Every src referenced by an image in the markdown, in document order, deduplicated.
export function extractImageSrcs(markdown: string): string[] {
  const seen = new Set<string>();
  for (const match of markdown.matchAll(IMAGE_MARKDOWN)) {
    seen.add(match[2]);
  }
  return [...seen];
}

// The stable keys referenced by the markdown (presigned URLs and other srcs excluded).
export function extractImageKeys(markdown: string): string[] {
  return extractImageSrcs(markdown).filter(isImageKey);
}

// Rewrite image srcs through `mapping`; a src absent from the mapping is left untouched.
// Non-image markdown is preserved byte-for-byte.
export function rewriteImageSrcs(markdown: string, mapping: Record<string, string>): string {
  return markdown.replace(IMAGE_MARKDOWN, (whole, alt: string, src: string, title?: string) => {
    const next = mapping[src];
    if (next === undefined) return whole;
    return `![${alt}](${next}${title ?? ''})`;
  });
}

// Display direction: swap each stored key for its presigned URL.
export function keysToSrcs(markdown: string, urlByKey: Record<string, string>): string {
  return rewriteImageSrcs(markdown, urlByKey);
}

// Save direction: swap each presigned URL back to its key. Guarantees no presigned
// URL is ever serialized. `keyByUrl` is the inverse of the resolve map.
export function srcsToKeys(markdown: string, keyByUrl: Record<string, string>): string {
  return rewriteImageSrcs(markdown, keyByUrl);
}

export function invert(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) out[v] = k;
  return out;
}
