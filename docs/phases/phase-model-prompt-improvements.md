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
| MPI-9 | `analysis@v9` — capture notes the way the user does: subject-first facts (ban "The team discussed X"), the user's note as the spelling/vocabulary authority, add `openQuestions` + `notableQuotes` fields, tighten `decisions` (a decision closes an option) + dedup, and name speakers instead of "Speaker N". From the 2026-07-23 manual-vs-generated corpus review | Not Started | MPI-8, MPI-10, Phase 29-A |
| MPI-10 | Eval fixtures from the real corpus — add 3–4 long, multi-party, anonymous-speaker, jargon-dense fixtures with the user's own note as gold, plus a "matches the user's style" judge dimension. Gates measuring MPI-9 | Not Started | 10-G |

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

**Status:** Not Started — from the 2026-07-23 manual-vs-generated corpus review (40 notes, 2026-07-02→07-22; 12 had generated content to compare against the user's own).

**Proposal:** Rewrite the analysis prompt so a generated note reads like the user's own — subject-first facts, the user's spelling, named speakers, open questions and verbatim quotes preserved — instead of neutral third-party minutes.

**The root cause (one sentence):** the user's note and the generated note answer different questions — the user's answers *"what do I now know, think, and need to chase?"*; `analysis@v8` answers *"what happened in this meeting?"* and is optimised for faithful minutes, which the user does not write.

**Why it's worth doing** — every gap below is evidenced in the 12 compared pairs:
- **"The team discussed X" boilerplate.** Bullets open with the meeting/the team as subject (`5c414838`: 6/6 bullets); the user writes the fact subject-first ("Teams in Value Streams own Core and Mobius", "7 ADMs to 5", "£50 per day").
- **Anonymous speakers.** Diarization emits "Speaker 1/Speaker 2"; the user attributes by name ("Jennifer — not bought in"; "Craig — no clear view of what fits each team"). Without names the notes lose their point.
- **The note is ignored as the vocabulary source.** v8 says *"DO NOT edit, rewrite, or reproduce it"*, which the model reads as *ignore it* → domain terms mis-spelled/invented (Sofija→Sophia, Crosslake→Cross Lake, TDM→"Technical Debt Managers", BCPL→Monarch).
- **Open questions and verbatim quotes are dropped.** The schema has nowhere to put either; the user captures both ("Is Tech Lead now responsible?"; "A little bit of stay in your lane").
- **`decisions` is malformed.** Duplicates `discussionPoints` (`e58e3aa0`: 3 "decisions" are the same 3 sentences reworded), or lists open questions as decisions (`ab0a4b1c`: "Determine the status of…"). Exact-duplicate bullets appear (`b0f4c248`: 6 of 17).
- **Judgement sanitised out.** The user's read ("Feels like a trap"; "danger this is being done to teams not by them") flattens to neutral prose. **Not** fixed by asking the model to editorialise — preserving verbatim quotes recovers most of the value without inventing opinions.

**The change (prompt-level `analysis@v9`, measured against MPI-10 fixtures):**
1. **Subject-first rule + rewrite pair.** Every bullet starts with the subject of the fact — a person, a system, a number. Banned openers: "The team", "The meeting", "There is a need to". Include a ✗/✓ contrast pair in the prompt.
2. **Note is the vocabulary authority.** Replace the "do not reproduce" wording with: spell every person, company, product and acronym exactly as the note spells it; the note wins over the transcript on any conflict; never expand an acronym the note leaves unexpanded. Feed the OGI-workspace **Glossary** note in as a workspace entity list where present.
3. **Two new output fields** — `openQuestions` (grounded: questions actually asked or left hanging, never invented) and `notableQuotes` (verbatim + who said it). Additive to the structured output.
4. **`decisions` defined properly** — a decision closes an option: names what was chosen and, where stated, who; nothing closed → empty list. Add an explicit "no two bullets may state the same fact" dedup rule (applies across `decisions` and `discussionPoints`).
5. **Speaker naming (prompt half).** Never emit "Speaker N"; map speakers to names where the transcript makes them unambiguous (self-intros, being addressed); leave the rest "unknown". The **data half** — passing the calendar attendee list into the analysis input, and reliable diarization — is a dependency (see *Depends on*), so v9's naming quality is capped until attendees are wired in.

**Cost:** Prompt-string rewrite + schema fields + one eval run — but only measurable once MPI-10 fixtures exist (current fixtures are short, single-party, named-speaker; none exercise the failure modes above). Deploy-time impact: **neutral** (prompt + additive schema fields). Adding `openQuestions`/`notableQuotes` is additive to `AnalysisResult` and its projections — no event-shape change.

**Commands in scope:** none · **Events in scope:** none (re-analysis re-runs the prompt; new fields flow through the existing analysis-completed path)

### Scope
- `PromptCatalog.V9` (`analysis@v9`) — v8 body plus the five changes above; `Current → V9` only if it wins on the MPI-10 fixtures with no regression on the existing 22.
- Extend the analysis structured output with `openQuestions: string[]` and `notableQuotes: {quote, speaker}[]`; surface them in `AnalysisResult`, the note-detail view/projection, and the note UI.
- Feed workspace glossary + calendar attendees into the prompt input where available (attendees may land as a dependency slice first).
- Compare via the harness: `Prompts = [V8, V9]`, on the MPI-10 corpus + the existing keep-set; target subject-first / naming / spelling / decisions-dedup improving with no drop on tags/actions/faithfulness.

- [ ] `analysis@v9` written; subject-first rule, note-as-vocabulary-authority, decisions-closes-an-option + dedup, speaker-naming (prompt half) all present with ✗/✓ examples
- [ ] `openQuestions` + `notableQuotes` added to the output schema, projections (both stores), and UI
- [ ] Beats v8 on the MPI-10 corpus (subject-first, spelling fidelity, decisions well-formed, no duplicate bullets) with no regression on the existing 22 fixtures
- [ ] Decision recorded in `docs/eval-runs/` + `test-matrix.md` updated

**Depends on:** MPI-8 (`analysis@v8` — the prompt v9 edits), **MPI-10** (fixtures — nothing here is measurable without them), Phase 29-A (`/ai` inline-instruction path preserved). Speaker *naming quality* additionally depends on calendar-attendees-into-analysis plumbing and diarization (see the diarization spike).

---

## MPI-10 — Eval fixtures that look like the user's real corpus

**Status:** Not Started — from the 2026-07-23 manual-vs-generated corpus review. Gates MPI-9.

**Proposal:** Add 3–4 fixtures drawn from the user's actual meetings, with the user's own note as the gold answer, plus a judge dimension that scores "does this read like the user's note?".

**Why it's worth doing:**
- None of the current 22 fixtures are 60-minute, multi-party, anonymous-speaker, or jargon-dense — the exact shape of the user's real notes. Every MPI-9 claim (subject-first, spelling fidelity, decisions-dedup, naming) is **unmeasurable** against them.
- The current gold notes are model-friendly minutes; the user's gold is subject-first facts with judgement and open questions. Scoring MPI-9 against minutes-shaped gold would report a false regression, exactly as MPI-8 needed its gold tags re-cut first.

**The change:**
- Add 3–4 fixtures from real transcripts/notes (anonymise names/companies as the existing fixtures do), each with the user's own note as `expected`.
- Add a Quality judge dimension — "matches the user's style" — scoring subject-first phrasing, name attribution, preserved open questions/quotes, and correct spelling of domain terms.
- Update `test-matrix.md` to record the enlarged corpus.

**Cost:** Fixture authoring + one judge-prompt addition. No prompt/model ships from this item — it is pure measurement infrastructure that MPI-9 consumes. Deploy-time impact: **none** (offline harness only).

**Commands in scope:** none · **Events in scope:** none

### Scope
- 3–4 new fixtures under the eval corpus with real-shaped transcripts + user-note gold; `FixtureCorpusTests` stays green.
- New judge dimension in the Quality rubric; `test-matrix.md` updated.

- [ ] 3–4 real-corpus fixtures added with the user's own note as gold; offline harness green
- [ ] "Matches the user's style" judge dimension added and calibrated
- [ ] `test-matrix.md` records the enlarged corpus

**Depends on:** 10-G (the eval harness).
