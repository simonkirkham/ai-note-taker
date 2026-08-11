# TI-65 — the same guard, and why it does not transfer

**What the user hit:** a note they had just deleted came back on the home list and stayed openable; one they had just created vanished; one they had just moved snapped back to its old folder. Any of those, for a few seconds after the action, whenever the projector was behind. [BUG-48] had already fixed the identical-looking problem for the note *body* three days earlier.

The interesting part is not the fix. It is that **BUG-48's fix would have made this worse**, and the reason generalises.

## The trap: two reads that look the same and are not

[BUG-48]: a gated read that exhausts its retries answers `X-Consistency: stale` and React Query stores it, overwriting fresher cached data. `useNoteDetail` now refuses that overwrite — it **holds the cached body**.

Applying that verbatim to the cards list is wrong, and the TI row said so before anyone wrote code:

| | Note detail | Cards list |
|---|---|---|
| Streams behind the read | One | Many |
| Streams the gate waits on | That one | **One** — the most recently written (design decision #7) |
| What `stale` therefore tells you | The whole body is strictly older | Only **that one note's row** is older. Nothing about the rest |
| "Hold the cache" costs | Nothing — the body is older by construction | Pins another tab's deletion into view; hides its addition |

So the shipped remedy takes the **server body** as the new list and reconciles exactly one row — the note the gate was waiting on. Every other row flows through untouched, which is the property "hold the cached list" would have destroyed.

**Reusable:** a consistency guard's blast radius is the set of streams its token covers. Before reusing one, ask what the token actually promised — not what the two call sites have in common.

## The discriminator nobody would guess: server id vs temp id

TI-65 named four callers and said each needs its own decision. It does not say *what* decides. It is this:

> **Does the optimistic writer patch the cache with the server's id, or with a temp id?**

`useCreateNote` inserts in `onSuccess` with the real `noteId`, so the gated id and the cached row agree and the reconcile works. `useAddAction`, `useCreateFolder` and `useCreateWorkspace` all patch with a caller-supplied `tempId` first. Lift the same guard there and it reads "cache lacks the gated row" — and **hides the thing the user just created**. A cure that produces the disease.

That is why only `getNoteCards` shipped. `getFolders` has a second disqualifier: it is a tree, so "the gated row" is not well defined for a move.

**Reusable:** when a guard matches server state against optimistic state by id, the guard's correctness depends on the *mutation* layer's id discipline, not on the read. Check every writer of that cache key before reusing it.

## Two defects review found that tests could not

Both were in the first shipped version, both passed the full 1052-test suite, and both are the same shape — **a bound whose key is wrong**.

1. **The hold budget was one global counter.** It bounded an unreachable token (the [BUG-27] lost-write case), but under sustained lag the allowance spent on note X left the *next* note the user deleted with **zero** protection — the original symptom, unmitigated. Now keyed per note. Residual filed as [TI-74]: it is keyed by note, not by write, so a second write to the *same* note inside one episode still inherits the exhausted count.
2. **`keys.noteCards` was re-resolved inside the `queryFn`.** That getter reads the module-global workspace id at *call* time, so a fetch issued for workspace A landing after a switch reconciled A's body against **B's** cache and wrote the result back into **A's** entry. Fix: use the `queryKey` React Query passes in.

**Reusable, and worth a lint-level habit:** never re-evaluate a `keys.*` getter inside an async `queryFn`. The key that identifies the query is handed to you; re-deriving it re-reads whatever global it closes over, at a moment that is by definition later than the fetch. Sibling of the existing out-of-order-response rule in the `frontend-react` skill.

**Reusable, on budgets:** when a budget bounds an *episode*, key it on whatever identifies the episode. Both defects above are the same mistake at different scopes — a counter keyed too broadly, and a cache key resolved too late.

## What proved it, and what did not

- **Red:** 5 failed / 4 passed against unmodified source, every failure behavioural.
- **Green:** 15/15.
- **Injected defect:** the reviewer reverted each fix one line at a time — 8 mutations in round 1, 2 in round 2. Each new spec goes red for its own fix and nothing else does, so the specs are *attributable*, not merely present.
- **Not proven:** no E2E journey asserts any of it. jsdom shows the query cache and the rendered list; it cannot show the real browser. Same limit as the standing "a which-request-fires property is unprovable in jsdom — only the deploy-gate E2E proves it" rule.
- **Follow-ups from this slice:** [TI-74] and [TI-75] — those two only. Higher TI numbers filed the same day belong to other sessions; a peer claimed an id mid-edit, so do not read a contiguous run as one slice's residue.

The third bullet is the one worth keeping. This repo has shipped guards whose tests stayed green with the guard removed ([BUG-48] itself, round 3). Mutation-probing is the only step that separates "the specs exist" from "the specs test this".

## Related

- [TI-65] — still open for `getActions`, `getFolders`, `getWorkspaces`
- [TI-74] — budget keyed by note, not by write
- [TI-75] — `gatedRead` retries re-resolve the workspace URL mid-gate (pre-existing; the remaining half of defect 2)
- [a-mechanism-nobody-has-watched-work-is-not-working](a-mechanism-nobody-has-watched-work-is-not-working.md) — the guard's `console.warn` on budget exhaustion exists because of it
