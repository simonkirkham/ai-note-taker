# 2026-07-26 — MPI-12: `analysis@v10`, style reverse-engineered by Opus 4.6

**Decision: ship `analysis@v10` (`PromptCatalog.Current → V10`), deploy #711.** First MPI shipped on **human judgment deliberately overriding the automated style score**.

## Method (novel — meta-prompting)

The user picked **5 real meetings**, each with a rich hand-written note + transcript (Support Process, Aggs & API Team Inception, Customer Data Migrations, Delivery process Q&A, Chat with Steve White — all OGI workspace). For each, we gave **Opus 4.6** (the prod model) the transcript + the user's own note and asked it to *reverse-engineer the system prompt that would reproduce the user's style*.

All 5 independently surfaced the **same style fingerprint** (the recurring rules, present in ≥4/5):
- Terse subject-first **fragments** — drop articles/verbs/filler.
- **Nested bullets under a short plain label**; person/topic-as-header ("Kristina" → facts; "Andrew Jackson - Head of Engineering").
- **No "X said" attribution**; name only for ownership/role/action; never "Speaker N".
- **Omit small talk, agreement noise, self-intros, banter.**
- **First-person framing** ("My remit", "What do I need access to").
- **Inline attributed actions**; `->`/`=` connectors; **open questions** captured (often a "Questions for X" block).

One thing Opus flagged in all 5 but that we **rejected**: it read the user's fast-typed misspellings as intentional and wanted the AI to reproduce typos. That's an artifact — v10 keeps clean spelling, with the note as authority for **proper-noun names only**.

## `analysis@v10`

v9 + a tightened style block encoding the schema-compatible recurring rules: fragments, entity-led "Name - facts" packing (one entity's facts in one dense bullet), `->`/`=` connectors, hard-omit non-content, `Q:` open-question capture, clean spelling. v9's grounding clamp, thin-transcript rule, proper-noun tags, action rule, and the `/ai` path are byte-identical.

## Result — human judgment over the metric

v9 vs v10 on the 5 real notes (Opus 4.6, note-as-input):

| Prompt | Quality | Style | Actions | Decisions | Content | Faithfulness |
| --- | --- | --- | --- | --- | --- | --- |
| v9 (was live) | 0.840 | 0.740 | 0.940 | 0.780 | 0.880 | 1.000 |
| **v10** | 0.820 | 0.700 | 0.960 | 0.880 | 0.900 | 0.994 |

The judge scored v10 style **−0.04** — but:
1. **Within n=5 judge noise** (±~0.1); 0.70 vs 0.74 is statistically a tie.
2. The judge is **under-sensitive to the exact dense entity-packing** that makes output read like this user (the MPI-9/MPI-10 blind-spot).
3. On the **actual side-by-side**, v10 reads visibly closer to the user's notes. Same meeting, v9 → v10:
   - v9: `Kristina: Agile Delivery Lead, OGI 7 years…` + separate bullets for teams.
   - v10: `Access needed - ADO Mobius 2 via OpenGI Entra…` / `Kristina - Agile Delivery Lead, OGI 7y, …, covers Shark Army + Vitruvius, also covering Master Builders + Justice League` (entity-led, `+` connectors, first-person opener — his actual style).
4. Other dims flat/up (decisions +0.10, content +0.02, actions +0.02); **faithfulness 0.994** (essentially unchanged).

**The user is the ground truth for their own style, and chose v10.** Recorded honestly: the automated style judge did not bless this; it ships because the human whose style it targets judged it closer, at no cost to faithfulness or the other dimensions.

## The ceiling — this is now a structural problem

The prompt lever has flattened at ~0.74 style. The remaining gap is **structural**: the user's notes nest facts under person/topic **headers**, but the app's flat `discussion[]` schema can only hold flat bullets. No prompt can produce the nesting. Going further requires a **freeform markdown `content` output field** (a feature: schema/event + projection + UI + eval) — logged in `future-features.md`. Tags/actions can still be extracted alongside for the index/to-dos.

## Caveats

- n=5; LLM-judge ±~0.1 noise. The v9-vs-v10 style delta is inside the noise — this is why the human judgment, not the number, is the deciding evidence.
- Real fixtures are the user's actual meetings — **local-only, git-ignored**, never committed.
