// BUG-47: the content optimistic-concurrency fingerprint, computed identically to the server's
// Domain.Notes.NoteContentHash — lower-hex SHA-256 over the UTF-8 bytes of the content. Sent as the
// base a content edit was made from so the server can reject an edit against stale/empty content it
// would otherwise silently overwrite. Both sides are pinned to the standard SHA-256 test vectors, so
// they can never drift apart.
export async function contentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
