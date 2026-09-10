# TI-83 — deleting the duplicate list beat policing it

**Date:** 2026-08-13 · **PR** [#477](https://github.com/simonkirkham/ai-note-taker/pull/477) · **squash** `4fbf7286`

**What was at stake:** a bug could be filed away as fixed while its row still sat on the open list — half-closed, with nothing on screen saying so — because the commit that does the filing ran no check at all. The check that exists to catch exactly that half-done close (`scripts/check-doc-ids.sh`) was gated behind a file-path filter that did not list the archive file.

---

## 1. Fixing by subtraction beat policing a duplicate

Two hand-typed `paths:` lists existed in `.github/workflows/docs-check.yml` because GitHub Actions has no YAML anchors — there is no way to share one list between two triggers. The obvious fix was a checker asserting `push.paths ⊇ pull_request.paths`.

The list was deleted instead, from the push trigger.

**Why that is the stronger fix, not the lazier one:** the list never scoped what got *checked*. `actionlint` lints every workflow in the tree and `check-doc-ids.sh` greps every tracking doc, whatever a commit touched. The list only decided whether the check *ran*. So it carried no benefit on the push route at all — it was pure drift surface, and a checker policing it would have been a second mechanism guarding a first mechanism that did nothing.

**Generalisable:** before writing a checker to keep two copies in step, ask what the duplicated thing actually buys. If it buys nothing on one side, delete it there — that closes every future instance of the drift, where a checker closes only the instances it happens to be looking at.

## 2. The asymmetry is the actual insight, and it is why the fix is one-sided

The pull-request list was kept. That is not inconsistency:

| Route | Drift is | Because | Other guard on this route |
| --- | --- | --- | --- |
| `pull_request` | **loud** | a check visibly stops appearing on pull requests | yes — a human reads the checks list on every PR |
| `push` to `main` | **silent** | nothing prints, nothing is missing from any screen | **none** — this is the route with no other guard |

So the silent side lost its list and the loud side kept it. **Where a failure is self-announcing, a filter is affordable; where it is silent, it is not.** The same reasoning decides any "should we keep the optimisation here too" question of this shape.

## 3. A review round was spent on a claim written in the register of a measurement

The first draft said archive commits *had been* skipping the check. That reads as a measured fact. It was an inference.

Measured:

| Question | Reading |
| --- | --- |
| Commits that have ever touched `phase-bugs-archive.md` on `main` | **11** |
| …of those, how many also touched `phase-bugs.md` (already in the PR list) | **11 — all of them** |
| When did the `push:` trigger start existing | `14c6c034`, 2026-08-12 ([TI-80]) |
| Newest archive commit | `bb4c5611`, 2026-08-11 — *before* the trigger existed |

**Latent hole, not observed miss.** The gap had never been exercised in either direction.

**The cost:** a whole review round, and the wrong version was written into **four permanent places** before it was checked — the tracking row, the workflow file's comment, the commit message and the PR body. A sentence with no hedge in it is read as measured whether or not anyone measured it, and the correction has to chase every copy.

**Rule:** write the hedge into the first draft (`latent, not observed`), or take the reading before writing the sentence. Never both after the fact.

## 4. The evidence was already in the repo while the pull request argued from inference

The item was being argued from reasoning about what the filter *would* do. The demonstration cost one commit: `proof/ti83-paths` commit `1cf9468d` changed only `phase-bugs-archive.md` and added a duplicate `## BUG-1` — the exact defect `check-doc-ids.sh` exists to catch — and produced **no run at all**.

Cite run [`31623178252`](https://github.com/simonkirkham/ai-note-taker/actions/runs/31623178252) as the durable record: it is the branch's *only* run, on the parent commit, and its existence-plus-absence is the whole proof. The branch has since been deleted, so `1cf9468d` no longer resolves — **a run id survives a branch delete; a sha on a deleted branch does not.** Cite the run.

## 5. The fix still has not been watched work, and the merge could not prove it

The core property — a push to `main` firing this workflow with **no** `paths:` at all — has never been observed.

Neither available run proves it, and both look like they might:

- the proof run ran against a file that still carried the full push list, and fired by matching `.github/workflows/**`;
- the merge commit itself touches `docs-check.yml` and `docs/technical-improvements.md`, **both in the old list**, so it would have run anyway.

A change whose whole effect is "this now runs in cases where it used to be skipped" cannot be proven by a case that was never skipped. **The confirming observation has to come from a commit that would have been filtered out** — a Scribe learnings doc, `CLAUDE.md`, `docs/token-log.md`, a `.csproj`, or an archive-only commit — and that is a post-merge step, recorded in the archive entry rather than assumed away.

This is the standing failure in [a-mechanism-nobody-has-watched-work-is-not-working.md](a-mechanism-nobody-has-watched-work-is-not-working.md): the merge is green, the review passed, and the mechanism has still produced nothing anyone has read. The one difference here is that it was *named* as unobserved at merge time instead of being discovered months later.

---

**See also:** [a-mechanism-nobody-has-watched-work-is-not-working.md](a-mechanism-nobody-has-watched-work-is-not-working.md) · [TI-83 archive entry](../technical-improvements-archive.md#ti-83-why-subtraction-beat-keeping-two-lists-in-step) · [TI-80](../technical-improvements.md#ti-80-the-push-trigger-needed-a-concurrency-change-the-row-did-not-predict) · [TI-84](../technical-improvements-archive.md#ti-84-a-momentary-github-outage-paints-a-red-x-on-a-main-commit-that-did-nothing-wrong)
