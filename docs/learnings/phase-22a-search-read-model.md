# Phase 22-A — Search read model + fuzzy endpoint

**Slice:** 22-A · **PR:** #186 · **Deploy:** #477 · **Date:** 2026-06-08

Added a `NoteSearchView` projection + `GET /notes/search?q=` that fuzzy-ranks a user's notes **in-Lambda** (FuzzySharp) — search with no search engine and $0 fixed infra. Four learnings worth keeping.

## 1. A new projection store needs a point-get-by-PK from the start, not just the GSI query

**What happened:** the search view is keyed by `NoteId` (PK) with a `UserId-index` GSI for the read endpoint. The first cut gave the store only `QueryByUserIdAsync` (the GSI query). The inline write path then fetched a single note's row with `QueryByUserId(...).FirstOrDefault(v => v.NoteId == id)` in **three** places (note create/rename/content/summary/tag, and action-item changes) — i.e. it scanned **all** of the user's search docs on **every** mutation to read one row by its own primary key. That is O(user-note-count) per write, compounding the exact linear-scan latency the phase doc flags as the graduation trigger.

**Fix:** add `GetByNoteIdAsync(NoteId)` (a point `GetItem` on PK) to the store interface and use it at all three sites. Hawk caught this.

**Why it matters:** when a projection store exposes a GSI query for the read side, it almost always also needs a **point-get on the PK for the write side's read-modify-write**. Scaffold both when you create the store — don't reach for the GSI query to fetch a row you already have the PK for. (Candidate addition to the `projection` skill.)

**Follow-up (BUG-12):** the added `GetByNoteIdAsync` shipped **without `ConsistentRead = true`** — the lone projection-store `GetItemAsync` that omits it (every other store sets it; it's in the `projection` skill's store checklist). On the inline read-modify-write a stale read could clobber a just-written field. Both the Pip brief and Hawk missed it; the convention check belongs in the Pip brief for any new store. Fixed in a one-line follow-up PR.

## 2. Cross-stream fields: live path and rebuild path derive them differently, and that's fine

Action items live on their **own** `ActionItem` streams, separate from the `Note` stream — so a note's own history can't replay its action-item text. Two convergent derivations:
- **Live:** `ActionItemCommandHandler` recomputes `ActionItemsText` from the note **card's** action items (already maintained there).
- **Rebuild:** the cross-stream `NoteSearchViewProjection` folds `ActionItem*` events across all streams (exactly how `NoteCardList` aggregates).

Both converge on the same value; the rebuild test proves it. **Don't force a projection's live update to replay foreign streams — derive from an already-maintained read model live, and let the rebuild projection do the cross-stream fold.**

## 3. Search is sensitive data — never log the query or content

The `SearchPerformed` EMF metric carries **only** `resultCount`, `notesScanned`, and latency — no raw query text, no note content. Meeting-note search terms are as sensitive as the notes (the same reason the whole feature stays in-AWS rather than going to a SaaS index). The one sanctioned comment in `PowertoolsDomainMetrics` documents *why*. **For any search/query telemetry, log shapes and counts, not the user's words.**

## 4. Process: `gh run watch <N>` takes the database ID, not the display run number

`gh run watch 477` (the deploy's display **number**) silently watched an unrelated run whose **database id** happened to be 477 — long completed — and exited `0`, reporting a **false green** while the real deploy was still queued. `gh run view 477` then 404s (also wants the db id).

**Fix:** resolve the id first — `gh run list --workflow deploy.yml --limit 1 --json databaseId` — and pass that to `watch`/`view`. Re-confirm a "green" deploy with an explicit `gh run view <dbid> --json status,conclusion,jobs` before treating it as the merge/Scribe gate; a clean `--exit-status 0` from `watch` is **not** sufficient on its own.

## Minor
- Fuzzy tuning: title weighted ×1.5, field score = `max(PartialRatio, TokenSetRatio)`, threshold 60, top 50. Verified `planing`→`planning` matches and clear non-matches return empty. Title weighting can push the returned `score` above 100 — acceptable, but 22-B should treat `score` as opaque ordering, not a percentage.
- EventStore.Integration is Docker-gated locally (skipped); CI's `eventstore` job ran it green. The slice touches no event-store internals.
- Prod auth-gated smoke skipped due to the standing Google refresh-token gap — operational, not a 22-A regression. The search endpoint is covered by 263 Api.Integration tests.
