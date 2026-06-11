import type { QueryClient } from "@tanstack/react-query";
import type { NoteCard } from "../api/notes";
import { keys } from "../api/queryKeys";

// Shared optimistic-maintenance helpers for the keys.noteCards cache.
//
// Phase 27-C moved read-model projections onto an async Projector Lambda, so the
// note-cards projection now lags a write by ~0.5-2s. An eager invalidate/refetch
// right after a write races that lag and sticks stale data (React Query marks the
// stale result fresh). The CQRS-client discipline: maintain the cache optimistically
// for read-after-write paths instead of refetching a lagging projection.

// Lag budget for the async Projector Lambda (27-C). Used by the rare delayed-reconcile
// path — where an optimistic patch genuinely can't construct the affected card rows
// (e.g. a deleted folder orphaning unknown notes, a brand-new meeting-note card) — so
// the deferred refetch lands after the projector has caught up, not racing it.
export const PROJECTOR_LAG_MS = 2000;

export type CardsCtx = { previousCards?: NoteCard[] };

// Snapshot the cards cache and apply an optimistic transform; returns the snapshot
// for rollback. No-op (returns an empty ctx) when the cache isn't populated, e.g. the
// list was never visited this session — the projection will be fetched fresh on first
// visit, which by then has caught up.
export async function patchCards(
  qc: QueryClient,
  apply: (cards: NoteCard[]) => NoteCard[],
): Promise<CardsCtx> {
  await qc.cancelQueries({ queryKey: keys.noteCards });
  const previousCards = qc.getQueryData<NoteCard[]>(keys.noteCards);
  if (previousCards === undefined) return {};
  qc.setQueryData<NoteCard[]>(keys.noteCards, apply(previousCards));
  return { previousCards };
}

export function rollbackCards(qc: QueryClient, ctx: CardsCtx | undefined) {
  if (ctx?.previousCards) qc.setQueryData(keys.noteCards, ctx.previousCards);
}

// Patch a single card in place, leaving the rest untouched. A no-op if the card
// isn't in the cached list (different filter/folder view, or not yet fetched).
export function patchOneCard(
  qc: QueryClient,
  noteId: string,
  apply: (card: NoteCard) => NoteCard,
): Promise<CardsCtx> {
  return patchCards(qc, (cards) =>
    cards.map((c) => (c.noteId === noteId ? apply(c) : c)));
}

const MAX_PREVIEW_LENGTH = 120;

// Mirror the server's BuildContentPreview (NoteHandlers.cs) closely enough for an
// optimistic card snippet: strip common markdown markers, collapse to a single
// paragraph, truncate at 120 with an ellipsis. The projector reconciles the exact
// text on the next genuine list fetch; this only has to look right immediately.
export function buildContentPreview(content: string): string {
  const stripped = content
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^\s*-\s+\[[ x]\]\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim();
  return stripped.length > MAX_PREVIEW_LENGTH
    ? stripped.slice(0, MAX_PREVIEW_LENGTH - 1) + "…"
    : stripped;
}
