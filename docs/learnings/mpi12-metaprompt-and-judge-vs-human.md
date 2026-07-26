# MPI-12 — meta-prompting, and when the human beats the judge

**Slice:** `analysis@v10` (#408, deploy #711, 2026-07-26). Data: [`docs/eval-runs/2026-07-26-mpi12-v10-metaprompt.md`](../eval-runs/2026-07-26-mpi12-v10-metaprompt.md).

## 1. Meta-prompting works: have the model reverse-engineer the prompt from gold examples

To capture a *personal* style, don't hand-write the style rules — give the prod model (Opus 4.6) the **transcript + the user's own note** for several real meetings and ask it to write the prompt that reproduces the style. Across 5 meetings it independently surfaced the **same fingerprint** (fragments, entity-led "Name - facts", omit small talk, `->`/`=`, open-questions). The agreement across independent examples is the signal — a rule in 5/5 is durable; a rule in 1/5 is meeting-type-specific (e.g. the coaching-feedback framing on the orientation-session note). This produced sharper, more specific style rules than a human staring at one note would.

**Caveat to filter:** the model over-reads *artifacts* as intent — it wanted to reproduce the user's fast-typed typos. Keep the human in the loop to reject artifacts (clean spelling; note is authority for proper-noun *names* only).

## 2. On subjective personal style, the human is the gold standard — not the LLM judge

The style judge scored v10 **below** v9 (0.70 vs 0.74). But: it was **within n=5 noise**, the judge is demonstrably under-sensitive to the exact dense entity-packing that reads like the user (seen at MPI-9 and MPI-10 too), and on the actual side-by-side v10 read visibly closer to the user's own notes. The user — whose style it is — chose v10.

**Rule:** an LLM-as-judge is a *proxy* for a preference. When the target is a specific person's subjective style and the metric delta is inside the noise, **the person's eyeball outranks the judge.** Ship on it — but record it honestly as a human override with the numbers, don't launder it as a metric win. (Guardrails still hold: v10 didn't regress faithfulness — 0.994 — or the objective dims, so the override cost nothing measurable.)

## 3. Know when a prompt has hit its ceiling — the next gap is structural

Three prompt iterations (v9, then v10) flattened style at ~0.74. The residual gap isn't wording — it's that the user's notes **nest facts under person/topic headers**, and the app's flat `discussion[]` schema physically can't hold nesting. No prompt breaks past a schema limit.

**Rule:** when successive prompt versions stop moving a dimension and the eyeball shows the same *structural* miss each time, stop tuning the prompt and re-frame it as a schema/output-shape problem (here: a freeform markdown `content` field — logged as a future feature). Prompt-tuning has a ceiling set by the output contract.
