# MPI-8 — proper-noun-only tags (`analysis@v8`)

**Slice:** narrow note tags to proper nouns only; ship `analysis@v8`. Eval `run-83741`. Deploy #609.

## The non-obvious traps (why this earns a doc)

### 1. The eval's headline "Tags" column is NOT the metric you think — it's the judge's holistic opinion, and it can contradict the deterministic score

`report.md` has a **Tags** column. It is `qualityTags` — the LLM quality judge's 0–1 holistic rating of the tag set. It is **not** the deterministic `tagF1` (precision/recall of predicted vs gold tags). The jsonl carries both per cell; the report only prints the judge one.

They diverged sharply for v8: judge `qualityTags` was **mixed** (Opus/Nova down), while atomic `tagF1` was a **clean sweep** (every model +0.49 to +0.63). Reason: the judge mildly **penalises sparse/empty tag sets** ("could have tagged more"), which is exactly the behaviour a precision-first change produces.

**Rule:** when a prompt change trades recall for precision (fewer, sharper outputs), read **atomic `tagF1` + precision + avg-count from the jsonl**, not the report's judge column. Judging a deliberately-sparser prompt by a recall-biased judge reports a false regression. (First instinct here was "v8 regressed tags" off the report column — wrong; the atomic metric showed a decisive win.)

### 2. When a change redefines what "good output" means, re-cut the gold IN THE SAME change — or the eval scores the new behaviour against the old definition

v6's gold tags mixed in meeting-types (`qbr`, `standup`) and topic keywords (`renewal`, `data-pipeline`). v8's whole point is to stop emitting those. Scored against v6's gold, a *correct* v8 loses recall on every dropped tag → **false regression**. The gold re-cut and the prompt change must land together. (This is the tag-label analogue of the existing "re-cut journeys when a read goes async" guardrail: the contract the test encodes must move with the behaviour.)

### 3. F1 on a sparse (1-tag) gold is brutal — gold strings must match the model's natural surface form

With a 1-tag gold, **any** surface mismatch = F1 0 (no partial credit). Round 1 (`run-63567`) scored v8 down partly because my gold said `umbrella`/`mobile-nav` but the entities are "Umbrella Corp"/"mobile navigation redesign" → v8's *correct* `umbrella-corp`/`mobile-navigation-redesign` scored 0. Hand-cut gold for a sparse-set metric must use the model's natural surface form (full hyphenated name), or you measure string-matching luck, not tag quality.

## What shipped

- `PromptCatalog.V8`: tags = **proper nouns only** (named orgs/clients, person-the-meeting-is-about, named products/projects/incidents); the named entity is a **must-tag**; empty is correct when nothing is named. `Current → V8`. v7's `/ai` path carried forward verbatim — only the tag rule differs.
- 22 fixtures' gold re-cut to that bar; `01-standup`/`02-one-on-one` became intentional empty/restraint fixtures; `FixtureCorpusTests` relaxed to a corpus-level guard (most-tagged + lowercase/hyphenated) instead of per-row non-empty.

## Result

Atomic `tagF1` v6→v8: Opus 0.48→0.97, Sonnet 0.38→0.93, Mistral 0.19→0.82, Nova Lite 0.16→0.70. Precision 3–7×; tags/note ~2.7→~1.1; no regression on content/actions/faithfulness. The user's preference (recorded): **fewer, more useful tags > more, weaker ones** — judge precision/cleanliness over recall.

## Follow-up candidate

Prod model is Nova Lite, which under v8 errs slightly sparse (recall 0.69 — occasionally one tag where two were valid). The eval flags `claude-sonnet-4-6` as a cleaner prod-upgrade (holds recall 1.0 while staying lean) — a possible future model-swap MPI item, not actioned here.
