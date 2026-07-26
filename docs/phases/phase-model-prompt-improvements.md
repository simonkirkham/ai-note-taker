# Phase Model & Prompt Improvements — Analysis quality backlog

**Goal:** A standing, unnumbered phase that captures iterative improvements to the AI analysis — new prompt versions, model swaps, and judge/eval changes — driven by what the [eval harness (10-G)](phase-10.md#slice-10-g--analysis-evaluation-harness) measures. Unlike a numbered phase this has no end: as long as analysis quality can be pushed higher, items are added here, evaluated with `make eval`, and marked Done as the winning prompt/model ships. Each item is still proven the normal way — measured against fixed transcripts via the harness before anything ships.

**What belongs here:** changes whose goal is *better analysis output* and whose evidence is an eval run — a new `analysis@vN` prompt, adopting/dropping a candidate model, changing the Quality judge, or tuning extraction precision from the captured feedback signal (10-I → 10-L). If it's new user-facing capability it's a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase); a defect is a **bug** ([docs/phases/phase-bugs.md](phase-bugs.md)); a small behaviour/appearance tweak is a **minor change** ([docs/phases/phase-minor-changes.md](phase-minor-changes.md)); a refactor/infra/CI item is a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** prompt engineering as a measured discipline — every change is justified by an eval delta, not taste. The companion artefacts are [`docs/eval-runs/`](../eval-runs/) (per-run decision reports) and [`docs/eval-runs/test-matrix.md`](../eval-runs/test-matrix.md) (the versioned set of models/prompts under test). Both are maintained by the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill, which also appends the next suggested item here after each run.

---

## Summary

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| MPI-1 | `analysis@v4` — deepen note content (the universal weak dimension) | Done (not shipped, `run-532442`) | 10-G, 10-O |
| MPI-2 | `analysis@v5` — keep V4's depth win, add a thin-transcript grounding clamp + restore V3 tag discipline | Done — ships (`run-551897`) | MPI-1 |
| MPI-3 | Model sweep — add `anthropic.claude-sonnet-4-6`, evaluate as replacement for the aged `claude-3-sonnet-20240229` value pick | Done (`run-28225`) | 10-G |
| MPI-4 | Fix the judge — give it the user's note as grounding + stop the content rubric auto-failing faithful terse notes | Done — terseness fixed; note-grounding partial (`run-28225`) | 10-G |
| MPI-5 | Programmatic note-grounding for the judge — prompt-level grounding proved insufficient; exclude note/gold entities from the fabrication check | Done (`run-78385`) — allowlist (#257) fixed sparse-fixture content (0.20→0.70–0.90) | MPI-4 |
| MPI-6 | Improve note tags — reword the prompt to ask for fewer, sharper tags (tagging is the AI's weakest output: 0.53–0.72 vs 0.85+ elsewhere) | Done (`run-286900`) — `analysis@v6` ships; tags +0.125 mean, Quality +0.028, no regression | MPI-2 |
| MPI-7 | `analysis@v7` — execute inline `/ai` instructions (Phase 29-A). Neutral-by-construction: no separate eval run | Done — ships (no eval run; see below) | MPI-6, Phase 29-A |
| MPI-8 | `analysis@v8` — narrow tags to **proper nouns only** (named orgs/clients, the person a meeting is ABOUT, named products/projects); always-tag the named org for consistency; drop meeting-types + topic keywords. Gold tags re-cut to the new bar | Done (`run-83741`) — `analysis@v8` ships; atomic tag F1 +0.49 to +0.63 per model, precision 3–7×, tags/note ~2.7→~1.1, no regression | MPI-6 |
| MPI-9 | `analysis@v9` — subject-first "longer but terser" prompt: ban "The team discussed X", named attribution (never "Speaker N"), reactions-not-judgement, `decisions`-closes-an-option + dedup, note-as-spelling-authority. Ships **with MPI-11 (Opus 4.6)**. New output fields (`openQuestions`/`notableQuotes`), a learned per-workspace vocabulary, and the speaker-naming *data* half (attendees) were **deferred** — see detail | Done (#405, deploy #708) — on Opus 4.6, v9 beats v8: **style +0.15, actions +0.10, decisions +0.10**, quality +0.075, faithfulness 1.0 | MPI-8, MPI-10, MPI-11, Phase 29-A |
| MPI-11 | Prod analysis model **Nova Lite → Opus 4.6** — the "capture my style" win is **model-gated, not prompt-gated**. One CDK single-source-of-truth change drives both the `BEDROCK_MODEL_ID` env var and the `InvokeModel` IAM grant | Done (#404, deploy #707) — on the user's own notes, Nova Lite/v8 **style 0.30 / quality 0.38 → Opus 4.6 style 0.63 / quality 0.79** (with v9: 0.775 / 0.86), faithfulness 1.0. Frontier (Opus 4.7/4.8, Sonnet 5, Fable 5) return Bedrock **AccessDenied** — Opus 4.6 is the invocable ceiling | 10-G |
| MPI-12 | `analysis@v10` — tighter subject-first style **reverse-engineered by Opus 4.6 from the user's own notes across 5 real meetings**: fragments (drop articles/verbs), entity-led "Name - facts" annotation, `->`/`=` connectors, hard-omit small talk, `Q:` open-questions, clean spelling (no invented typos). `Current` → v10, supersedes v9 as the live prompt | Done (#408, deploy #711) — **shipped on human judgment**: style judge scored v10 0.70 vs v9 0.74 (within n=5 noise), but the user (ground truth for their own style) judged v10's output reads more like their notes; faithfulness 0.994, other dims flat/up. Remaining gap is **structural** — nested-under-headers needs a freeform-content output (future feature) | MPI-9, MPI-11 |
| MPI-10 | Eval fixtures from the real corpus — 4 real meetings with the user's own note as gold (local, git-ignored) + a "matches the user's style" judge dimension. Gates measuring MPI-9 | Done (#399) — style dimension shipped; baseline v8/Nova Lite **style 0.20** on the real corpus (faithfulness 1.0) — the floor MPI-9 must raise | 10-G |

Further items are appended as each eval run surfaces the next weakest dimension. The `eval-run` skill proposes them (see [How items are added](#how-items-are-added)).

---

## How items are added

This backlog is fed by the eval loop, not drafted up front. After each `make eval` run, the [`eval-run`](../../.claude/skills/eval-run/SKILL.md) skill:

1. Writes the per-run decision report under `docs/eval-runs/` and updates `test-matrix.md`.
2. Derives the **next suggested improvement** — usually targeting the weakest Quality dimension, or a model worth adding/dropping — and **checks with the user** before recording it.
3. On the user's go-ahead, appends a new `MPI-N` row to the Summary table above and a detail section below (format: see the eval-run skill's [MPI item format](../../.claude/skills/eval-run/SKILL.md) — lead with a one-line **Proposal**, scannable **Why it's worth doing** bullets, a **Cost** line, then **Steps**), citing the eval run that motivated it.

Items are never deleted — a shipped or abandoned item is marked `Done`/`Dropped` with the deciding eval run, so the history of what was tried (and why) survives alongside `test-matrix.md`.

---

## MPI-1 — `analysis@v4`: deepen note content

**Status:** Done — `analysis@v4` built and evaluated (`run-532442`, [report](../eval-runs/2026-06-04-v3-v4-content.md)); **not shipped**. V4 delivered the targeted Content lift on the weaker models (Nova Lite **+0.100**, Sonnet +0.048) but failed this item's own acceptance bar: it **worsened fabrication on the sparse fixtures** (`17-budget-review`, `14-all-hands-reorg` — invented "Cyberdyne"/"Stark Industries" more than V3), dropped Tags on all four models, and regressed the strong models (Mistral −0.054 Quality, Opus −0.015). `analysis@v3` stays shipped. The depth win is real on the production model, so the work continues in **MPI-2** (`analysis@v5`). Faithfulness scored ~1.0 even on fabricated cells, confirming it can't gate grounding — see the MPI-2 scope and the run report's Caveats.

**Value:** Across **every** model and both prompts, **Content** is the only Quality dimension still below ~0.75 — the universal weak spot (see the frontier `v2`-vs-`v3` run, [docs/eval-runs/2026-06-04-frontier-v2-v3.md](../eval-runs/2026-06-04-frontier-v2-v3.md)). Because all models share it, it's a *prompt* problem, not a model one. Draft `analysis@v4` that pushes for fuller capture of the discussion's substance (not headline-only), measure v3-vs-v4 with the harness, keep the winner.

**The two failure modes the run-468475 outputs actually show** (read the low-`qualityContent` rows + `run-468475-outputs.md`): content is penalised for **both**, and they pull in opposite directions —
1. **Thinness (dominant):** the discussion is reduced to topic labels with no substance — e.g. the `01-standup` note's whole discussion was `- Login bug` / `- Updating docs`. Judge: *"far too thin, lacking detail and depth"*.
2. **Fabrication on sparse transcripts:** on short fixtures (`17-budget-review`, `14-all-hands-reorg`) models invent ungrounded detail — e.g. Opus hallucinated a company name, *"Cyberdyne"*, and even emitted it as a tag. Judge: *"adds ungrounded content"* → content 0.20.

So v4 must chase **depth where the source supports it and restraint where it doesn't** — "fuller capture" alone would make the sparse-transcript cases worse. Note also that **Faithfulness did not catch the fabrication** (it scored 1.00 on the Cyberdyne row); only the LLM judge's `qualityContent` did. So this run's faithfulness column can't be used to confirm v4 didn't regress grounding — that gap is its own follow-up (a candidate **MPI-2**: a fabrication/grounding probe the harness can detect).

**Commands in scope:** none · **Events in scope:** none

### Scope
- Add `PromptCatalog.V4` (`analysis@v4`) — same structured output as V3. Two paired instruction changes:
  - **Depth:** capture the *substance* of each discussion point (the what + the why / the number / the context), not a bare topic label; include an explicit **deep-vs-shallow contrast** example in the prompt so the model sees the target.
  - **Grounding restraint:** include only what the transcript/note supports; never invent names, numbers, companies, or commitments; when the transcript is thin, a short note is correct — do **not** pad. Preserve V3's minimal-tags rule and its "only the current user's actions, omit if ambiguous" rule.
- Compare via the harness: `Prompts = [V3, V4]`, `EVAL_PRESET=frontier`, read `report.md` — target the **Content** column rising **without** regressing Tags / Actions / Decisions, **and** without the sparse fixtures (`17-budget-review`, `14-all-hands-reorg`) sprouting invented detail (eyeball their `-outputs.md` sections, since faithfulness won't flag it).
- If V4 wins, ship it (switch `PromptCatalog.Current`, as 10-O did for V3) and record the decision via the `eval-run` skill in `docs/eval-runs/`. Otherwise iterate.

- [ ] V4 mean Content beats V3 across the frontier models, no regression on Tags / Actions / Decisions
- [x] No new fabrication on the sparse fixtures vs V3 (manual check of their outputs) — **failed**: V4 fabricated *more* on the sparse fixtures
- [x] Decision recorded in `docs/eval-runs/` and `test-matrix.md` updated — [report](../eval-runs/2026-06-04-v3-v4-content.md), matrix v2

**Depends on:** 10-G (the harness), 10-O (ship `analysis@v3` first so V4 iterates from the shipped baseline).

---

## MPI-2 — `analysis@v5`: keep the depth win, clamp thin-transcript grounding

**Status:** Done — `analysis@v5` built and evaluated (`run-551897`, [report](../eval-runs/2026-06-04-v3-v4-v5-grounding.md)); **ships**. V5 lifted the production model (Nova Lite Quality **+0.066** / Content **+0.089** vs v3) and overall (mean Quality +0.039, Content +0.065), **restored the tags** V4 dropped (mean +0.025 vs v3), and produced correctly terse, **non-fabricating** notes on the sparse fixtures. A bonus finding: V4's prior "fabrication regression" was a **judge error** (the flagged "Cyberdyne"/"Stark Industries" are in the fixtures' user-note + gold tags). Ship action: switch `PromptCatalog.Current` → V5. The remaining weak spot is the **measurement**, not the prompt — carried forward to MPI-4.

**Value:** `run-532442` showed V4's depth wording earns a **+0.100 Content** lift on the production model (Nova Lite) and +0.048 on Sonnet — a genuine win on the dimension that is still the weakest everywhere. But V4 is not shippable: the same depth push tips sparse transcripts into **fabrication** (inventing company names not in the source) and **drops Tags** on all four models. V5's job is to bank the depth gain while removing the two regressions, so a content-deepening prompt can finally ship.

**Commands in scope:** none · **Events in scope:** none

### Scope
- Add `PromptCatalog.V5` (`analysis@v5`) — start from V4's structured output and depth wording (the deep-vs-shallow contrast example stays; it's what earns the Nova Lite lift). Two targeted hardenings:
  - **Thin-transcript grounding clamp that beats the depth push.** V4 already told the model to be restrained on thin input, but the depth instruction overrode it. V5 must make the clamp dominant: an explicit rule that when the transcript is sparse, a **short** note is the correct output, and **never name an entity (company, person, product, number) that does not appear verbatim in the source**. Consider an ordered instruction ("grounding before depth") or a worked sparse-transcript example showing a correctly terse note.
  - **Restore V3's tag discipline.** V4 dropped Tags on all four models; pull V3's minimal-tags wording back in verbatim.
- Compare via the harness: `Prompts = [V3, V4, V5]`, `EVAL_PRESET=keep`, read `report.md`. Targets:
  - V5 holds V4's **Content** lift on Nova Lite (≈+0.10 vs V3) and Sonnet.
  - V5 does **not** regress Tags vs V3 on any model.
  - **No new fabrication on `17-budget-review` / `14-all-hands-reorg`** vs V3 — eyeball the `-outputs.md` sections, since Faithfulness (~1.0) is blind to it.
  - Ideally recovers some of the strong-model (Mistral/Opus) Quality V4 lost.
- If V5 clears the bar, ship it (switch `PromptCatalog.Current`, as 10-O did for V3) and record the decision via the `eval-run` skill.

- [x] V5 keeps V4's Content lift on the production model without the fabrication regression on the sparse fixtures — Nova Lite Content +0.089 vs v3; no fabrication (judge prose confirms)
- [x] V5 does not regress Tags vs V3 on any keep-set model — Tags mean +0.025 vs v3 (up on Nova Lite/Opus, flat Sonnet, only Mistral −0.023)
- [x] Decision recorded in `docs/eval-runs/` and `test-matrix.md` updated — [report](../eval-runs/2026-06-04-v3-v4-v5-grounding.md), matrix v3

**Depends on:** MPI-1 (V4's wording and the run-532442 findings are the starting point).

---

## MPI-3 — Swap-test `claude-sonnet-4-6` as the value pick

**Status:** Done — `claude-sonnet-4-6` swept on `analysis@v5` (`run-28225`, [report](../eval-runs/2026-06-10-sonnet-4-6-model-sweep-judge-fix.md)). **It wins:** top model overall (Quality **0.850**), beating the aged `claude-3-sonnet-20240229` (0.820, **+0.030**) and Opus (0.811, **+0.039**) at lower cost. Decision: **add `claude-sonnet-4-6` as `**keep**`, drop `claude-3-sonnet-20240229`** (same vendor, dominated). It also leads the prod model Nova Lite (0.814) by +0.036 — a prod-upgrade candidate (cost/latency review, non-vendor judge confirmation needed first; not actioned here). Matrix bumped to v4. Access confirmed: invoked cleanly on-demand in eu-west-2, zero skips.

**Proposal:** Add `anthropic.claude-sonnet-4-6` to the keep-set; run one model-only sweep on the shipped prompt (`analysis@v5`).

**Why it's worth doing:**
- The current "value pick", `claude-3-sonnet-20240229`, is an early-2024 model — almost certainly beaten by the current-gen Sonnet. The keep-set should track current models.
- One sweep answers: keep the old Sonnet, or swap it.
- May also move the **prod model** — V5 put Nova Lite within −0.021 of Opus, so a strong, cheaper Sonnet could become the new prod default.

**Cost:** ~1 sweep (keep-set + 1 model) × 22 fixtures, one prompt. Access is **confirmed live** (`run-551897`: Anthropic models invocable on-demand in prod) — not blocked.

### Steps
1. Add `claude-sonnet-4-6` to the matrix; sweep model-only on `analysis@v5`.
2. Rank vs the keep-set; decide keep/drop on `claude-3-sonnet-20240229`.
3. Record via the `eval-run` skill; update `test-matrix.md`.

- [x] Swept on `analysis@v5`; new Sonnet ranked vs the keep-set — top of the keep-set (0.850)
- [x] Keep/drop decision recorded in `test-matrix.md` + report — matrix v4; 2024 Sonnet dropped, Sonnet-4-6 kept

**Depends on:** 10-G (the harness).

---

## MPI-4 — Fix the judge: note-blindness + terseness penalty

**Status:** Done — judge rubric reworded and re-run (`run-28225`, [report](../eval-runs/2026-06-10-sonnet-4-6-model-sweep-judge-fix.md)). **Terseness penalty fixed:** the content rubric now judges thinness relative to the source, so faithful-terse notes on thin transcripts are no longer auto-capped at ≤0.4 — `17-budget-review` content rose to 0.80–0.90 on three models. **Note-grounding only partially fixed:** the rubric now names the existing note as valid grounding, but the LLM judge still mis-flags note-only entities as fabrication where they recur through the output (`14-all-hands-reorg`'s gold-tag "Stark Industries" → content 0.20, faithfulness 1.00). Prompt wording is necessary but insufficient; a programmatic fix is carried to **MPI-5**. Code: `BedrockQualityJudge.BuildPrompt` (extracted for unit testing) + `BedrockQualityJudgePromptTests`.

**Proposal:** Give the quality/faithfulness judges the user's note as grounding context, and stop the content rubric auto-failing a faithful, justified-terse note on a thin transcript.

**Why it's worth doing:**
- Note-blindness already produced wrong calls — the judge flagged grounded gold-tag entities ("Cyberdyne"/"Stark Industries", both in the fixtures' user-note) as fabrication; it sank V4 in `run-532442` and nearly sank V5.
- The terseness penalty (content ≤0.4 even when fully faithful) fights the grounding clamp V5 just shipped — sparse-fixture content scores can't be trusted until it's fixed.
- Both are *measurement* bugs: they distort every future prompt comparison, not just one run.

**Cost:** Prompt-only edits to the two judges in `tests/Analysis.Eval/Scoring/` (`BedrockQualityJudge`, `ContentJudge`/faithfulness). No new infra. Re-run V5 to confirm sparse-fixture scores rise with no prompt change.

### Steps
1. Pass `existingContent` (user note) into the judge prompts as valid grounding alongside the transcript.
2. Reword the content rubric so a faithful note that is short *because the transcript is thin* is not auto-failed to ≤0.4.
3. Re-run V3/V5 on the keep-set; confirm the sparse fixtures (`17-budget-review`, `14-all-hands-reorg`) no longer mis-score, and no prompt regressed.

- [x] Judges receive the user note; rubric names it as grounding — **partial**: prompt edit done, but the judge still mis-flags note-only gold entities (`14-all-hands-reorg`) → carried to MPI-5
- [x] Sparse-fixture content scores reflect faithfulness, not length — terseness floor removed (`17-budget-review` 0.20→0.90 on 3 models)
- [x] Decision recorded in `docs/eval-runs/` + `test-matrix.md` — [report](../eval-runs/2026-06-10-sonnet-4-6-model-sweep-judge-fix.md), matrix v4

**Depends on:** 10-G (the harness).

---

## MPI-5 — Programmatic note-grounding for the judge

**Status:** Done (`run-78385`, [report](../eval-runs/2026-06-13-mpi5-programmatic-grounding.md)) — the deterministic allowlist (#257) closed the judge's note-blindness. The quality judge receives the fixture's gold tags (humanised) as a `GROUNDED ENTITIES — never flag as fabrication` block, replacing MPI-4's prompt-only grounding. **Confirmed:** `14-all-hands-reorg` content rose **0.20 → 0.70–0.90** across all four keep-set models, now consistent with faithfulness (1.00); `17-budget-review` 0.80–0.90. No prompt/model change. Next weak dimension is **Tags** (0.527–0.720) — carried to a future MPI item.

**Proposal:** Stop relying on prompt wording for note-grounding — extract the user-note (and gold-tag) entities and exclude them from the quality judge's fabrication check programmatically, or add a held-out non-vendor judge to confirm sparse-fixture content.

**Why it's worth doing:**
- MPI-4's prompt edit proved **insufficient**: `run-28225` still scored `14-all-hands-reorg` content at 0.20 because the judge flagged "Stark Industries" (in the user's note, a gold tag) as fabrication, faithfulness 1.00 on the same cell. Even Opus's rationale admits the entity is in the note, then penalises it.
- Sparse-fixture content scores still can't be trusted per-cell, so every future prompt comparison on thin transcripts stays distorted — a measurement bug, not a one-run artefact.
- A deterministic grounding check removes judge variance on the dimension MPI-1/2 spent two runs chasing.

**Cost:** Harness-only. Either (a) inject note/gold entities into the faithfulness reference and have the quality judge defer to it, or (b) a parallel non-vendor judge on the sparse fixtures. No infra. One confirming re-run of `analysis@v5` on the keep-set.

### Steps
1. Build the grounded-entity allowlist from the fixture's **gold tags** (humanised from kebab-case) — the deterministic, curated set of entities grounded by definition; the user note already appears verbatim in the prompt. Pass them to the quality judge as an explicit "these are grounded, do not call them fabrication" allowlist.
2. Re-run `analysis@v5` on the keep-set; confirm `14-all-hands-reorg` / `17-budget-review` content scores reflect faithfulness, not entity-flagging.
3. Record via the `eval-run` skill; update `test-matrix.md`.

- [x] **Allowlist wired** (#257): `GroundedEntities.From(fixture)` humanises + dedups gold tags; `BedrockQualityJudge.BuildPrompt` renders the `GROUNDED ENTITIES` block; `EvalRunner` populates it per row. 16 targeted unit tests; full `Analysis.Eval` green. Harness-only, `paths-ignore`d → no deploy.
- [x] Note/gold entities no longer flagged as fabrication on the sparse fixtures — `14-all-hands-reorg` content 0.20→0.70–0.90 (`run-78385`)
- [x] Sparse-fixture content scores consistent with faithfulness across all keep-set models — content 0.70–0.90 vs faithfulness 1.00 on `14`/`17`, all 4 models
- [x] Decision recorded in `docs/eval-runs/` + `test-matrix.md` — [report](../eval-runs/2026-06-13-mpi5-programmatic-grounding.md), matrix v5

**Depends on:** MPI-4 (the prompt-level edit and the `run-28225` finding that it's insufficient).

---

## MPI-6 — Improve the tags the AI puts on each note

**Status:** Done (`run-286900`, [report](../eval-runs/2026-06-13-mpi6-tags-v6.md)) — `analysis@v6` ships; `PromptCatalog.Current` → `V6`. Tightening only the tag rule lifted tags on every keep model (+0.05 to +0.20, mean **+0.125**) and overall note Quality on every model (mean **+0.028**), with no regression. Tags is no longer the universal weak dimension (only Mistral stays sub-0.75 at 0.689 — now the clearest model drop candidate).

**The change:** Rewrite the *tagging* part of the analysis prompt to ask for fewer, sharper tags. Prompt wording only — no code-behaviour or model change.

**What this is about:** Tags are the keywords the AI attaches to each note (e.g. `acme`, `hiring`, `1:1`) so you can later find related notes. Good tagging = a small set of meaningful, reusable tags. Bad tagging = too many tags, or vague/generic ones that don't help you find anything.

**Why it's worth doing:**
- **Tagging is the weakest thing the AI does.** In the latest eval (`run-78385`) every model scored lowest on tags (0.53–0.72 out of 1.0) while everything else — the summary, decisions, action items — scored 0.85+. Tags are the one part dragging note quality down.
- **It's a wording problem, not a model problem.** All four models are weak on tags in the same way, so the fix is in the instructions we give them, not in which model we pay for. One prompt edit improves every model at once.
- **It directly helps you find notes.** Tags are the main way to pull up related notes later; better tags mean the feature actually works for retrieval instead of adding noise.

**Cost:** Cheap and safe. A prompt edit plus one eval run comparing the new wording against the current one on the 22 test transcripts. Nothing ships unless the numbers improve.

### Steps
1. Add a new prompt version (`analysis@v6`) — same as today's `v5` but with a tighter tag rule: pick a *small* set (aim 2–3, never more than ~5) of meaningful, recurring tags (people/companies, projects, meeting type); no generic filler; fewer is better. Leave everything else in v5 unchanged.
2. Run the eval comparing `v5` vs `v6` on the keep-set; check the tag score goes up and nothing else drops.
3. If `v6` is better, make it the live prompt and record the decision.

- [x] `v6` tag score beats `v5` across all keep-set models, with no drop in summary / decisions / action-item quality — tags +0.05 to +0.20 (mean +0.125), Quality +0.028, no regression (`run-286900`)
- [x] Decision recorded in `docs/eval-runs/` + `test-matrix.md` — [report](../eval-runs/2026-06-13-mpi6-tags-v6.md), matrix v6

**Depends on:** MPI-2 (today's live prompt `analysis@v5` — the starting point `v6` edits).

---

## MPI-7 — `analysis@v7`: execute inline `/ai` instructions

**Proposal:** Ship `analysis@v7`, which executes inline `/ai` instructions a user wrote in their notes and returns a per-instruction response, **without a separate eval run** — the change is neutral-by-construction for everything the eval measures. Shipped as part of [Phase 29-A](phase-29.md).

**Why no eval run (and why that is correct here):**
- `BuildV7` **delegates to `BuildV6` byte-for-byte when the note has no `/ai` instruction** (`PromptCatalog.cs`). So for every fixture in the eval matrix — which contains **no `/ai` fixtures** — v7 produces the *exact* v6 prompt and therefore the exact v6 output. A v7-vs-v6 run would compare a prompt to itself: zero delta, no information.
- The eval **cannot** measure the only thing v7 changes (the instruction-response path), because no fixture exercises it. Running it would burn Bedrock calls to confirm `v7 == v6` on inputs that don't touch the new code.
- The new path's *correctness* (extraction, execution, recording, clearing, rendering) is proven deterministically by Domain.Specs + Api.Integration (fake Bedrock) + vitest — the right tools for behaviour the eval can't see.

**Decision (2026-06-17):** ship `v7` as `Current`; record this row in lieu of an eval report. If/when `/ai` fixtures are added to the matrix, a future MPI item can measure instruction-response *quality* (a genuinely new dimension), but that is not a regression risk for existing analysis.

- [x] `v7` neutral for the eval matrix by construction (delegates to `v6` when no `/ai` instruction) — no summary/discussion/decisions/tags regression possible
- [x] New `/ai` path covered by Domain.Specs + Api.Integration + vitest (not eval)

**Depends on:** MPI-6 (today's live prompt `analysis@v6` — the path `v7` delegates to), Phase 29-A.

---

## MPI-8 — `analysis@v8`: proper-noun-only tags

**Status:** Done — `analysis@v8` ships (`run-83741`, [report](../eval-runs/2026-06-22-mpi8-proper-noun-tags.md)); `PromptCatalog.Current` → `V8`. Atomic tag F1 up on every keep model (Opus 0.48→0.97, Sonnet 0.38→0.93, Mistral 0.19→0.82, Nova Lite 0.16→0.70), precision 3–7×, tags/note ~2.7→~1.1, no regression on content/actions/faithfulness. The raw `report.md` "Tags" column (the judge's holistic `qualityTags`) is mixed because the judge mildly penalises sparse sets — the deterministic atomic tagF1 is authoritative and matches the fewer-but-useful preference. One iteration was needed: `run-63567` had two gold typos + a v8 that over-anchored on orgs (dropping named incidents/projects); both fixed for `run-83741`.

**Proposal:** Narrow the tag rule from "person/company/team/project **or meeting-type or topic keyword**" (v6/v7) to **proper nouns only** — named organisations/clients/vendors, the specific person a meeting is *about*, and named products/projects/work-streams — and make the named organisation a **must-tag** so a given client groups across every note.

**The user-reported problem:** tags are too many, and the same company is not tagged consistently (e.g. not every Crosslake/OGI call is tagged as such).

**Why v6's rule causes both:**
- v6 permits **three different kinds** of tag — a proper noun, a meeting-type (`1:1`, `standup`, `qbr`), *and* a short topic keyword (`auth`, `hiring`). A fuzzy, three-category target over-generates and varies run-to-run.
- Nothing makes the named client mandatory, so it competes against a meeting-type for the "2–3 tag" budget and is sometimes dropped — the inconsistency.

**The change (wording only, no model/behaviour change):**
- Tag **only** proper nouns: named orgs/clients/vendors; the person a 1:1/review is *about* (not mere participants/speakers); named products/projects/work-streams.
- **Always** tag every named organisation — the most important tag, so all of a client's notes group together.
- Explicitly **drop** meeting-types and generic topics/activities (`onboarding`, `renewal`, `reorg`, `observability`, …).
- An **empty** tag list is the correct answer when no proper noun is named.
- v8 keeps v7's `/ai` instruction path verbatim and becomes `Current`.

**Why the gold tags must be re-cut first:** the 22 fixtures' gold tags themselves mix in meeting-types and topic keywords (`standup`, `1:1`, `qbr`, `renewal`, `growth`, `data-pipeline`). Scored as-is, a correct proper-noun-only prompt loses recall on those and the F1 scorer reports a **false regression**. So the gold set is re-cut to the proper-noun-only definition (orgs/people-subjects/named products) — 20 of 22 carry ≥1 proper-noun tag; `01-standup`/`02-one-on-one` name no proper noun and become intentional **empty/restraint** fixtures. The judge's grounded-entity allowlist is unaffected (every note-only org name — `stark-industries`, `cyberdyne`, `wayne-enterprises` — is retained).

**Cost:** Prompt + fixture wording + one eval run (`EVAL_PRESET=keep`, `Prompts=[v6, v8]`). Nothing ships unless tags rise on the new bar with no regression elsewhere. Deploy-time impact: **neutral** (prompt-string change only).

**Commands in scope:** none · **Events in scope:** none

### Scope
- `PromptCatalog.V8` (`analysis@v8`) — v7 body, tag rule rewritten to proper-nouns-only; `Current → V8`. Added to the eval `AllPrompts`.
- Re-cut `expected.tags` in all 22 fixtures to proper nouns only; relax `FixtureCorpusTests` to allow deliberate empty-tag restraint fixtures and to assert tags are lowercase+hyphenated.
- Run `EVAL_PROMPT_VERSIONS=analysis@v6,analysis@v8 EVAL_PRESET=keep make eval`; read `report.md`. Ship v8 if it wins.

- [x] `analysis@v8` proper-noun-only tag rule added; `Current → v8`; `/ai` path preserved
- [x] Gold tags re-cut to proper-nouns-only across all 22 fixtures; offline harness green
- [x] v8 tag F1 beats v6 on the keep-set against the re-cut bar (+0.49 to +0.63 atomic tagF1 per model), with no drop in summary / decisions / action-item quality
- [x] Decision recorded in `docs/eval-runs/` + `test-matrix.md` updated — [report](../eval-runs/2026-06-22-mpi8-proper-noun-tags.md), matrix v7

**Depends on:** MPI-6 (today's live prompt `analysis@v6` — the starting point `v8` edits).

---

## MPI-9 — `analysis@v9`: capture notes the way the user writes them

**Status:** Done (#405, deploy #708, 2026-07-23) — `PromptCatalog.Current → V9`. Shipped **the prompt-only style rewrite**: subject-first bullets (bans "The team discussed X"), "longer but terser" density, named attribution (never "Speaker N"), reactions-not-judgement, `decisions`-closes-an-option + dedup, and the user's note as spelling authority. Keeps v8's grounding clamp, proper-noun tags, and the `/ai` path byte-identical. Validated on the prod combo (Opus 4.6 + the user's 4 real notes, note-as-input): v9 beats v8 — **style 0.625→0.775 (+0.15), actions 0.70→0.80 (+0.10), decisions 0.80→0.90 (+0.10)**, quality 0.79→0.86, faithfulness 1.0. The Nova-Lite actions regression seen pre-model-swap did **not** reproduce on the capable model. Report: [`2026-07-23-mpi9-mpi11-opus46-v9.md`](../eval-runs/2026-07-23-mpi9-mpi11-opus46-v9.md). **Deferred (not in v9):** the new output fields (`openQuestions`/`notableQuotes`), the learned per-workspace vocabulary, and the speaker-naming *data* half (calendar attendees into the analysis input) — all still future work; the shipped v9 is the prompt levers only.

_(Original scope below, kept for the deferred items.)_

**Proposal:** Rewrite the analysis prompt to capture the way the user writes — **longer but terser: maximum coverage of facts, minimum words, no filler, structured with headers + bullets** — subject-first factual bullets, the user's spelling, named speakers.

**The user's north star (2026-07-23 feedback):** *"Longer but terser is exactly what I am going for. I want more coverage of topics and facts but with less words. I don't need filler. Structuring them with headers/bullets helps keep them dense."* The goal is **not** better prose — it is denser fact capture. The user's own note is the gold standard (avg 255 words, 40 lines, **63% of lines bulleted**; the generated note is ~30 words of prose + ~6 flat bullets, and its length is *uncorrelated* with how much the user wrote — 366-word note → 12-word summary; 21-word note → 17 padded bullets).

**The change (prompt-level `analysis@v9`, measured against MPI-10 fixtures), in the user's priority order:**
1. **Subject-first factual bullets — the #1 lever (user: "the most important in my eyes").** Every bullet starts with the subject of the fact — a person, a system, a number. Banned openers: "The team", "The meeting", "There is a need to", "focusing on". Prefer short fragments over sentences; drop filler verbs/connectives. Include a ✗/✓ contrast pair. Evidence: `5c414838` opened 6/6 bullets with "The team discussed…"; the user writes "Teams in Value Streams own Core and Mobius", "7 ADMs to 5", "£50 per day".
   - **Capture current state, then options.** Meetings discuss the current state before moving into options; capture that current-state/factual layer as fully as possible in short facts — this is where coverage matters most.
   - **Structure for density.** Group facts under short headers with nested bullets (not one flat list), mirroring how the user structures notes.
   - **Length tracks the source.** Coverage scales with how much substance the transcript holds — never pad a thin meeting, never compress a dense one to a sentence.
2. **Name speakers (high value).** Never emit "Speaker N"; map speakers to names where the transcript makes them unambiguous (self-intros, being addressed); leave the rest "unknown". The **data half** — calendar attendee list into the analysis input + reliable diarization — is a dependency (see *Depends on*), so naming quality is capped until attendees are wired in.
3. **The user's note + workspace vocabulary is the spelling authority.** Replace v8's *"DO NOT edit, rewrite, or reproduce it"* (the model reads it as *ignore it*): spell every person/company/product/acronym exactly as the note spells it; note wins over transcript on conflict; never expand an acronym the note leaves unexpanded. Fixed misspellings like Sofija→Sophia, Crosslake→Cross Lake, TDM→"Technical Debt Managers", BCPL→Monarch. Fed by a **learned per-workspace vocabulary** (see the vocabulary sub-item below).
4. **Flag reactions, not judgement (user: "my judgement so no need for AI — but flag people's reactions").** Do **not** editorialise or infer opinions. Do capture *observable* reactions grounded in the transcript — "Jennifer pushed back", "Craig unconvinced", agreement/disagreement/hesitation — as facts, attributed.
5. **Notable quotes where useful (user: "good where useful… hard for AI but let's try").** A `notableQuotes` field, verbatim + who said it, used with **restraint** — only genuinely notable lines, never a quota. Recovers judgement value without inventing opinions.
6. **`decisions` defined properly + dedup.** A decision closes an option: names what was chosen and, where stated, who; nothing closed → empty list. Add "no two bullets may state the same fact" across `decisions`/`discussionPoints`. Evidence: `e58e3aa0` (3 "decisions" = same 3 sentences reworded), `ab0a4b1c` ("decisions" that are open questions), `b0f4c248` (6 of 17 duplicate bullets).
7. **`openQuestions` — a field the USER authors (user: "I expect to add these mostly — it's my interpretation").** Add the field for manual capture; the AI may surface only questions *explicitly asked and left hanging* in the transcript, and must never invent them. Low AI effort — this is primarily a place for the user to add their own questions.

**Dropped from v9 vs the original filing:** facilitator/coaching feedback (user: "don't worry about feedback too much — that's my judgement"). The coaching angle moves entirely to the deprioritised note-lens feature.

#### Learned per-workspace vocabulary (feeds change 3)
The user asked for ideas on how the AI learns domain spellings. Cheapest-first:
- **Seed from the user's Glossary note** (already maintained in OGI) — feed verbatim as the canonical spelling list.
- **Mine the user's own note bodies** — a workspace projection accumulates proper nouns (names/companies/products/acronyms) from *the user's* notes (not transcripts) with frequency + the user's spelling as canonical; feed the top ~50 into each analysis prompt as "known vocabulary — use exactly these spellings". Self-reinforcing.
- **Calendar attendees → canonical people spellings.**
- **Learn from corrections** *(bigger, later)* — when the user edits a generated name (Cross Lake→Crosslake), capture the pair as a vocabulary correction.

The first three are prompt-input + one projection; the last is a feature. Speaker naming (change 2) and this vocabulary share the calendar-attendees plumbing.

**Cost:** Prompt-string rewrite + `openQuestions`/`notableQuotes` schema fields + a workspace-vocabulary projection + one eval run — only measurable once MPI-10 fixtures exist. Deploy-time impact: **neutral** for the prompt; the vocabulary projection is a new read model (ships empty → needs a backfill). New fields are additive to `AnalysisResult` — no event-shape change.

**Commands in scope:** none · **Events in scope:** none (re-analysis re-runs the prompt; new fields flow through the existing analysis-completed path)

### Scope
- `PromptCatalog.V9` (`analysis@v9`) — v8 body plus changes 1–7 above; `Current → V9` only if it wins on the MPI-10 fixtures with no regression on the existing 22. Emphasis order: subject-first density (1) first, then naming (2) and vocabulary (3).
- Extend the analysis structured output with `openQuestions: string[]` and `notableQuotes: {quote, speaker}[]`; add a `reactions`/attribution treatment inside discussion capture; surface them in `AnalysisResult`, the note-detail view/projection (**both** stores), and the note UI.
- Workspace-vocabulary source: glossary note + a proper-noun projection over the user's own notes + calendar attendees, fed into the prompt input (may land as a dependency slice first; ships empty → backfill).
- Compare via the harness: `Prompts = [V8, V9]`, on the MPI-10 corpus + the existing keep-set; target denser subject-first coverage / naming / spelling / decisions-dedup improving with no drop on tags/actions/faithfulness.

- [ ] `analysis@v9` written; subject-first density rule (short facts, current-state-first, headers+nested bullets, no filler, length-tracks-source), speaker-naming, note+vocabulary spelling authority, reactions-not-judgement, decisions-closes-an-option + dedup — all present with ✗/✓ examples
- [ ] `openQuestions` (user-authored) + `notableQuotes` added to the output schema, projections (both stores), and UI
- [ ] Learned per-workspace vocabulary wired into the prompt input (glossary + own-note proper nouns + attendees)
- [ ] Beats v8 on the MPI-10 corpus (denser fact coverage, fewer words, subject-first, spelling fidelity, decisions well-formed, no duplicate bullets) with no regression on the existing 22 fixtures
- [ ] Decision recorded in `docs/eval-runs/` + `test-matrix.md` updated

**Depends on:** MPI-8 (`analysis@v8` — the prompt v9 edits), **MPI-10** (fixtures — nothing here is measurable without them), Phase 29-A (`/ai` inline-instruction path preserved). Speaker naming + learned vocabulary additionally depend on calendar-attendees-into-analysis plumbing and diarization (see the diarization spike).

---

## MPI-10 — Eval fixtures that look like the user's real corpus

**Status:** Done (#399, merged 2026-07-23) — a `style` dimension ships on the quality judge; 4 real fixtures with the user's own note as gold live in the git-ignored `eval-fixtures-real/` (real data, public repo — never committed). Baseline `analysis@v8` on Nova Lite scores **style 0.20** on the real corpus (faithfulness 1.0), the judge naming the exact gap ("prose paragraphs instead of Simon's bullet style", "misses Simon's bullet-heavy note style"). Eval-harness-only change — never deployed. Report: [`docs/eval-runs/2026-07-23-mpi10-style-baseline.md`](../eval-runs/2026-07-23-mpi10-style-baseline.md). Gates MPI-9.

**Proposal:** Add 3–4 fixtures drawn from the user's actual meetings, with the user's own note as the gold answer, plus a judge dimension that scores "does this read like the user's note?".

**Why it's worth doing:**
- None of the current 22 fixtures are 60-minute, multi-party, anonymous-speaker, or jargon-dense — the exact shape of the user's real notes. Every MPI-9 claim (subject-first, spelling fidelity, decisions-dedup, naming) is **unmeasurable** against them.
- The current gold notes are model-friendly minutes; the user's gold is dense, subject-first fact capture. Scoring MPI-9 against minutes-shaped gold would report a false regression, exactly as MPI-8 needed its gold tags re-cut first.

**The change:**
- Add 3–4 fixtures from real transcripts/notes (anonymise names/companies as the existing fixtures do), each with the user's own note as `expected`.
- Add a Quality judge dimension — "matches the user's style" — scoring **fact coverage per word** (longer-but-terser: many facts, few words, no filler), subject-first phrasing, name attribution, and correct spelling of domain terms.
- Update `test-matrix.md` to record the enlarged corpus.

**Cost:** Fixture authoring + one judge-prompt addition. No prompt/model ships from this item — it is pure measurement infrastructure that MPI-9 consumes. Deploy-time impact: **none** (offline harness only).

**Commands in scope:** none · **Events in scope:** none

### Scope
- 3–4 new fixtures under the eval corpus with real-shaped transcripts + user-note gold; `FixtureCorpusTests` stays green.
- New judge dimension in the Quality rubric; `test-matrix.md` updated.

- [x] 4 real-corpus fixtures added with the user's own note as gold (local, git-ignored); offline harness green (115/115)
- [x] "Matches the user's style" judge dimension added and calibrated — baseline discriminates cleanly (style 0.20 vs content 0.63 vs faithfulness 1.0), rationales on-target
- [x] `test-matrix.md` records the enlarged corpus + the style dimension

**Design decisions (build notes):**
- **Input = transcript only** (`existingContent` empty), **gold = the user's note** — measures whether the prompt reproduces the user's dense style from the transcript, not whether it echoes a note handed to it as input.
- The style rubric **does not penalise** omitting the user's private judgement/questions absent from the transcript (the user authors those) — it scores style + transcript-grounded fact coverage only.
- Style is **nullable**; the report averages it only over gold-note fixtures, so the synthetic committed corpus shows "—", not a diluting 0.

**Depends on:** 10-G (the eval harness).

---

## MPI-11 — prod analysis model: Nova Lite → Opus 4.6

**Status:** Done (#404, deploy #707, 2026-07-23) — prod Command + TranscribeCompletion Lambdas confirmed `BEDROCK_MODEL_ID = anthropic.claude-opus-4-6-v1`.

**The finding:** the "capture my style" gap is **model-gated, not prompt-gated**. Measured on the user's own 4 notes with the note passed as input (real prod conditions), current prompt `analysis@v8`:

| Model | Style | Quality | Faithfulness |
| --- | --- | --- | --- |
| `amazon.nova-lite-v1:0` (prod before) | 0.30 | 0.38 | 1.00 |
| `anthropic.claude-sonnet-4-6` | 0.50 | 0.70 | 1.00 |
| **`anthropic.claude-opus-4-6-v1`** (prod now) | **0.75** | **0.84** | 1.00 |

Prompt changes (`analysis@v9`) added a further +0.15 style on Opus 4.6 but were near-neutral vs the model jump — the model is the dominant lever (this is why the earlier `analysis@v9`-only sweeps on Nova Lite looked flat/regressive: a weak model can't adopt the style, a capable one already does).

**Ceiling is Opus 4.6 — the account can't invoke the true frontier.** Opus 4.7/4.8, Sonnet 5, and Fable 5 are listed as Bedrock inference profiles in eu-west-2 but return `AccessDeniedException: not available for this account` on invoke (each newer Anthropic model is a separate AWS-Marketplace product needing a first enabling invoke by a Marketplace-permissioned principal — the deploy user isn't one). Opus 4.6 / Sonnet 4.6 were enabled earlier (MPI-3) and are invocable. To test/use the frontier: a human enables it via the Bedrock Model catalog playground, **or** test off-Bedrock with a first-party Anthropic API key (Claude Max is chat-only — no API access).

**Cost:** Opus-tier is ~80–100× Nova Lite per token; at single-user, few-notes-a-day volume, cents/day. Deploy-time: **neutral** (env-var + IAM-scope change, no bake window).

**Commands in scope:** none · **Events in scope:** none (per-note re-analysis; historical events keep their originally-stamped `modelId`)

### Scope
- `NoteTakerStack.cs` default `bedrockModelId` `amazon.nova-lite-v1:0` → `anthropic.claude-opus-4-6-v1` — single source of truth for the env var **and** the `bedrock:InvokeModel` IAM grant (the ARN re-derives; direct foundation-model id → foundation-model ARN branch).
- `InfraAssertionsTests.cs` default-model assertion updated; 164/164 CDK assertions green.

- [x] Prod model swapped; both Lambdas verified live on Opus 4.6
- [x] IAM grant re-scoped automatically (no separate edit); frontier-access limitation documented
- [x] Decision recorded in `docs/eval-runs/` + `test-matrix.md`

**Depends on:** 10-G (the eval harness).

---

## MPI-12 — `analysis@v10`: style reverse-engineered by Opus 4.6 from the user's own notes

**Status:** Done (#408, deploy #711, 2026-07-26) — `PromptCatalog.Current → V10`. Report: [`2026-07-26-mpi12-v10-metaprompt.md`](../eval-runs/2026-07-26-mpi12-v10-metaprompt.md).

**How it was built (novel method):** the user picked 5 real meetings (each with a rich hand-written note + transcript). We fed **Opus 4.6** — the prod model — each transcript + the user's own note and asked it to *reverse-engineer the prompt* that would reproduce the user's style. All 5 independently surfaced the same style fingerprint. v10 = v9 + a tightened style block encoding the recurring rules v9 under-specified:
- **Fragments, not sentences** (drop articles/verbs): "OGI for 7 years", not "He has been at OGI…".
- **Entity-led annotation**: "Kristina - Agile Delivery Lead, OGI 7y, covers Shark Army + Vitruvius" — one entity's facts packed into one dense bullet.
- **Compact connectors** `->` (flow/ownership) and `=` (status).
- **Hard-omit** small talk / agreement noise / self-intros (the social half → zero bullets).
- **`Q:` open-question capture** (grounded only).
- **Clean spelling** — do NOT reproduce the user's fast-typed typos; keep the note's proper-noun spellings only.

v9's grounding-first clamp, thin-transcript rule, proper-noun tags, action rule, and the `/ai` path are byte-identical.

**Shipped on human judgment over a noisy metric.** On 5 real notes (Opus 4.6, note-as-input) the style judge scored v10 **0.70 vs v9 0.74** — but that is **within n=5 judge noise (±0.1)**, the judge is under-sensitive to the exact dense entity-packing that reads like this user (same blind-spot as MPI-9/MPI-10), and on the actual side-by-side v10 reads visibly closer to the user's own notes (`Name -` annotation, `+` connectors, first-person "Access needed -" opener). **The user — the ground truth for their own style — chose v10.** Other dims flat/up (decisions +0.10, content +0.02, actions +0.02); faithfulness 0.994. This is the first MPI shipped where human judgment deliberately overrode the automated style score.

**The structural ceiling (not this slice).** The prompt lever has hit its limit (~0.74 style). The remaining gap is structural: the user's notes **nest facts under person/topic headers**, which the flat `discussion[]` schema cannot hold. Going further needs a freeform markdown `content` output field (a feature — schema/event + projection + UI + eval) — see [future-features.md](../future-features.md).

**Commands in scope:** none · **Events in scope:** none

### Scope
- `PromptCatalog.V10` (`analysis@v10`) — v9 body, `style`/`discussionDecisions`/`noteAuthority` blocks tightened; `Current → V10`. Added to eval `AllPrompts`.
- `PromptCatalogTests`: `Current_is_v10` + v10 spec test (pins the new rules + the v9 carry-overs + no-new-fields + `/ai`).

- [x] `analysis@v10` written; `Current → v10`; both prod consumers (Builder, TranscribeCompletion) flip
- [x] Evaluated v9 vs v10 on the 5 real notes (Opus 4.6); human override recorded with the numbers
- [x] Decision recorded in `docs/eval-runs/` + `test-matrix.md`; structural ceiling logged as future work

**Depends on:** MPI-9 (`analysis@v9` — the prompt v10 edits), MPI-11 (Opus 4.6 — the model it was designed on).
