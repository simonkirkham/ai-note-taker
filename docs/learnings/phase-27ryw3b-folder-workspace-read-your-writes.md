# RYW-3b — read-your-writes for folder + workspace flows

**Slice:** 27-RYW-3b · **PR** #266 · **Deploy** #555 green

Migrated folder (create/rename/move/delete) and workspace (create/rename/delete) to async + RYW, mirroring RYW-2/3a. Two things worth keeping.

## 1. A multi-stream write gates on its *primary* stream, not all affected streams

A cascade folder-delete touches many streams: the target folder, every descendant folder (each gets its own `DeleteFolder` append), and the notes it unfiles (note# writes). But the client holds **one** write token, and the gated `GET /folders` waits on only that one — the **target** folder's version (design decision #7: "wait on the stream the user wrote").

Consequence: in prod the projector applies streams independently, so a gated read can return after the target row is gone but before a descendant row is — a brief orphaned descendant until the next read self-heals. For a single-user app the projector lag is sub-second, so this is acceptable, not a bug. But the general rule matters: **single-token RYW gives read-your-writes for the stream you wrote, not transactional visibility of every side-effect.** If a flow's *primary* user-visible effect lives on a secondary stream, gate on that one — or the guarantee misses what the user is actually checking for.

## 2. Verify a doc's "must re-add X" instruction against current code before doing it

The phase doc (written at RYW-1 time) said RYW-3b must "re-add the `FolderDeleted`/`WorkspaceDeleted` arms to `ProjectionUpdater`." Scoping found they were **already present** — re-added in RYW-1's foundation work — along with `StreamProjector` routing for `folder-`/`workspace-`. So 3b only had to remove the inline writes; the projector already deleted correctly (proven by the `Delete*_ProjectorRemovesIt` tests). A planning doc records intent at a point in time; the foundation slice may have already discharged a "later" instruction. Check the code, don't re-do the already-done.

## 3. The migration is functionally complete after 3b (see [[phase-27ryw3c-analysis-already-migrated]])

With folders/workspaces migrated, **every** projected stream type is in `MigratedPrefixes` and every command handler is append-only. The supposed RYW-3c "analysis migration" turned out to be a no-op (analysis rides on `note#`/`action#`, already migrated) — so RYW-4's "last inline write removed → projector is sole writer" condition is already true. RYW-4 is now cleanup-only.
