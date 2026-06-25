# Phase 20-E — Note detail (TanStack migration)

Migrated NoteView's note-detail domain to one `keys.note(id)` query. The slice is routine; three non-obvious decisions are worth keeping.

## 1. Commits patch the single-consumer cache; they do not invalidate it

The spec said each commit should `invalidateQueries(keys.note)`. As shipped, commits **patch** `keys.note` instead (content/date via `onSuccess setQueryData`; tags/link/transcription via `onMutate`+rollback). Only **analyse** invalidates `keys.note`.

| | Invalidate-on-commit (spec text) | Patch-on-commit (shipped) |
|---|---|---|
| Refetch per blur | yes (churn) | no |
| Static-handler tests | revert the optimistic state (a refetch returns the pre-write fixture) | stay green |
| Keystone principle (single consumer + optimistic==server) | violated | honoured |

**Why patch is correct here:** `keys.note(id)` has exactly one consumer (the open NoteView). Verified there is **no server-side normalization** of content/date (no trim/sanitize in `src/Domain` or the command handlers), so the optimistic value *equals* what the server stores — a refetch would return the same bytes. The one field the client genuinely cannot predict is the analysis output (summary/discussion/decisions/extracted actions); that is the single mutation that invalidates `keys.note` (+ `keys.actions`). This is the same keystone rule 20-D established, and it satisfies the spec's own Observability §2 ("avoid `keys.note` churn during editing").

**When invalidate *would* be right:** if the server ever normalizes content/date on write, switch those commits back to invalidate so the client picks up the canonical form.

## 2. Draft pattern beats seeding local state from the query

Editable content/date use `displayed = draft ?? data.field`; `onChange` sets the draft, `onBlur` saves, `onSuccess` clears it. `draft !== null` is the dirty flag and the draft is the latest value — it replaces the old `contentModifiedRef` + `contentRef` + `tagsModifiedRef` outright.

It beats the alternative (seed local state from query data) on two counts: (a) **two-way reconciliation** — when clean (`draft === null`) the field follows server truth, so a background refetch updates it; a seeded copy goes stale to the server until remount; (b) **lint-safe** — no `set-state-in-effect` and no ref-writes-during-render (both are hard CI gates here). The mandatory guard test types unsaved text, triggers a `keys.note` refetch (add a tag), and asserts the text survives.

## 3. Sync the remote before reading the plan (process)

This slice was first built against a **stale local `phase-20.md`**: the session's checkout sat ~3h behind `origin/main`, where 20-F was already merged and a different, authoritative 20-E spec (the draft pattern) already existed. The first attempt (PR #198) used a divergent seed-state approach and had to be thrown away.

**Fix applied:** `git fetch` + check `origin/main` **before** reading any planning doc or starting a slice — the phase docs are shared state another session edits on the remote, so the working tree is not a reliable "current". Codified in [[feedback_fetch_before_planning]].
