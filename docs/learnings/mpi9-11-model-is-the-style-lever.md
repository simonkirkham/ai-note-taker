# MPI-9/MPI-11 — the model is the style lever, not the prompt

**Slice:** prod analysis Nova Lite → Opus 4.6 (#404) + `analysis@v9` (#405), 2026-07-23. Full data: [`docs/eval-runs/2026-07-23-mpi9-mpi11-opus46-v9.md`](../eval-runs/2026-07-23-mpi9-mpi11-opus46-v9.md).

## 1. When a quality *dimension* barely moves under prompt edits, suspect the model tier before iterating the prompt

The goal was "make the auto notes read like mine" (dense, subject-first). Two rounds of prompt work (`analysis@v9`) on the prod model (Nova Lite) moved the style score ~+0.05 and *regressed* action extraction. The judge kept saying "prose, not bullets" no matter how explicit the instruction.

The cause was the model, not the wording. A weak model **can't adopt a format** however prescriptively you ask; a capable model **already produces it** and doesn't need the instruction. On the exact same v8 prompt: Nova Lite style 0.30, Sonnet 4.6 0.50, **Opus 4.6 0.75**. The single biggest lever was the model swap, not any prompt version.

**Rule:** if a targeted rubric dimension is flat across prompt iterations, run the same prompt on a stronger model *before* writing prompt vN+1. The prompt is the wrong knob when the model is the ceiling.

## 2. "Listed" ≠ "invocable" on Bedrock — verify with a real invoke

`aws bedrock list-inference-profiles` showed Opus 4.8 / Sonnet 5 / Fable 5 in eu-west-2, which read as "available." They are not: a `converse` call returns `AccessDeniedException: <model> is not available for this account`. Each newer Anthropic model is a separate **AWS-Marketplace** product needing a one-time enabling invoke by a Marketplace-permissioned principal; the deploy user isn't one. The invocable ceiling for the account is **Opus 4.6**. Enabling the frontier is a human console action (Model catalog → Playground; the old *Model access* page is retired), or test off-Bedrock with a first-party API key. (A **Claude Max** subscription is chat/Claude-Code only — no Developer-Platform API.)

**Rule:** before planning around a Bedrock model, prove it invocable with an actual `converse`, not a catalog/profile listing.

## 3. Serialise eval runs — they share one results directory

`scripts/run-eval.sh` writes to `tests/Analysis.Eval/bin/Debug/net10.0/Results`, `rm -rf`s it at start, and `Report` reads **every** `*.jsonl` in it. Two runs overlapping (I fired the next before a prior one's Report finished) produced a **contaminated report** — 8+2 fixture counts, rows from a run I didn't launch, wrong model rows. It looks like real data.

**Guardrail:** never run two evals concurrently. Before trusting any report, sanity-check the per-(model,prompt) row counts equal the fixture count (a `python3` one-liner over the jsonl). A mismatch = contamination, not signal.

## 4. Verify the *exact prod combination* before shipping — regressions can be model-specific

`analysis@v9` regressed action extraction on Nova Lite (−0.10). That would have blocked it — except the regression **did not reproduce on Opus 4.6** (actions +0.10 there). Testing v9 against the *old* model would have wrongly killed a change that's a clean win on the *new* one. The confirming run was v8-vs-v9 on Opus 4.6 — the actual shipped pairing.

**Rule:** a prompt change riding a model change must be validated on the *new* model, not the one being retired.

## 5. Empty `existingContent` understates prod — real conditions pass the user's note

MPI-10's fixtures deliberately used empty `existingContent` (a fair "generate style from the transcript alone" test). But prod **always** passes the user's note as input, and the note is itself a large style + spelling lever: with the note present, the same model jumps from style ~0.52 to ~0.80. Measuring "what the user actually experiences" requires the note in the input.

**Rule:** keep an empty-note fixture for prompt isolation, but read the *prod-representative* number from a note-present fixture.
