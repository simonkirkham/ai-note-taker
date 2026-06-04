# Learnings: ship analysis@v5 (MPI-2)

- Eval harness `EVAL_PROGRESS_FILE` and `EVAL_FIXTURES_DIR` were read relative to the **test-host cwd** (the bin output dir), not the repo root — so a relative value silently broke: `progress.log` nested one dir deep, and the real-fixtures run found 0 cases. **Action:** anchor both to absolute paths in `run-eval.sh` + document the gotcha in the harness guide — Done (PR #166).
- The run-532442 "v4 fabrication regression" that disqualified v4 was a **judge error**, not a real failure. The flagged entities ("Cyberdyne"/"Stark Industries") are in each fixture's `existingContent` (the user's note) **and** are expected gold tags; the prompt explicitly allows grounding in the note, but the quality judge compared only against the transcript. The judge is **note-blind**. **Action:** MPI-4 — give the quality/faithfulness judges the user's note as grounding context — TODO (pending user OK).
- The content rubric scores a sparse note ≤0.4 **even when fully faithful** ("a light/sparse note is a major failure"), which fights the grounding clamp v5 just shipped: a correctly terse note on a thin transcript is penalised as if it were thin-by-failure. **Action:** MPI-4 — rubric should not auto-fail a faithful, justified-terse note on a sparse transcript — TODO.
- Cross-run variance is large (~0.07 on Content between run-532442 and run-551897 for the same model/prompt). Comparing a new prompt against a **prior run's** numbers conflates prompt effect with run-to-run noise. **Action:** always sweep every compared prompt version in **one** run; added the rule to the harness guide — Done.
- Working on the shared `main` checkout with files staged let a **concurrent commit grab the staged index** — eval work landed on `main` with the wrong message; recovery needed a reset + branch surgery. **Action:** do slice/PR work in a dedicated worktree (per the existing worktree convention), never stage on the shared `main` checkout while another actor may commit; reinforced the [[feedback_main_staged_index]] memory — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. Eval env-var relative-path bug | Applied — `run-eval.sh` absolute anchoring + guide note (#166) |
| 2. Judge is note-blind | TODO — MPI-4, pending user OK |
| 3. Content rubric penalises justified terseness | TODO — MPI-4, pending user OK |
| 4. Cross-run variance → one-sweep rule | Applied — harness guide |
| 5. Shared-checkout staged-index collision | Applied — memory reinforced; use a worktree |
