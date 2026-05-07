# Token Usage Log

Approximate tokens consumed per slice, broken down by agent. Recorded by Scribe at the end of each slice. Counts come from agent hand-off summaries; round to nearest 1 000.

---

<!-- Scribe: append one section per completed slice using this template:

## Slice <id> — <name>

| Agent     | ~Tokens    |
|-----------|------------|
| Scout     |            |
| Breaker   |            |
| Pip       |            |
| Stylist   |            |
| Hawk      |            |
| Scribe    |            |
| **Total** |            |

-->

## Slice 3-A — Add action items on the note screen

> **Note:** Session exhausted context and was auto-compacted. Exact per-agent counts unavailable. Figures below are estimates from the session summary.

| Agent     | ~Tokens |
|-----------|---------|
| Scout     | 18 000  |
| Breaker   | 25 000  |
| Pip       | 95 000  |
| Stylist   | —       |
| Hawk      | 35 000  |
| Scribe    | 10 000  |
| **Total** | **~183 000** |

**Why so large:** First cross-aggregate slice — introduced `ActionId`, new aggregate, new projection, new DynamoDB table (CDK), new API handler pair, React component extraction, E2E journey. Hawk required two fix rounds (missing E2E test; `GetActions` returning 200 for non-existent notes). Refactor pass also ran within Pip's turn.
