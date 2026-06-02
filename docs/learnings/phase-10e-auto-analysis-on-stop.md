# Learnings: 10-E Auto-analysis on stop

- The auto-fire effect originally gated on `hasRecordedThisSession` alone, so an empty recording would auto-analyse (and surface a spurious 422 on an empty note). **Action:** gated the auto-fire additionally on a non-empty `transcript`; added specs for the empty-recording and second-recording-rearm paths (Hawk suggestions) — Done.
- The new auto-fire-on-stop meant the pre-existing stop-flow tests started emitting MSW "unhandled request" warnings for the analyse/transcription POSTs. **Action:** added default `204` handlers for `POST /notes/:id/transcription` and `/analyse` in the shared `web/src/test/handlers.ts`; tests that assert specifics still override via `server.use` — Done.
- **Merge-gate failure (the important one):** 10-E (PR #117) was merged while deploy **#403 was in progress** and while the PR's own CI was still **pending**. The gate command `gh run list --status completed --limit 1` is blind to in-progress runs, and `gh pr merge --auto` merged immediately rather than waiting (no required-status-check branch protection). **Action:** rewrote the `CLAUDE.md` merge gate to inspect the *latest* deploy run's status+conclusion (wait out any in-progress run) **and** require `gh pr checks` all green before merge; updated workflow step 11 and the [[merge-gate-main-deploy-only]] memory — Done.
- Multiple agent sessions sharing the primary `main` checkout collided: another session reset/committed main while I had an unpushed local commit. It survived only because their commit landed on top of mine. **Action:** when other sessions are active, make doc/guardrail commits in an isolated `git worktree` from `origin/main` and push from there, never in the shared checkout — Documented (applied for this very Scribe commit).
- Stylist skipped: the switch is styled to match the sibling `transcription-update-content-toggle`. **Action:** none — consistent micro-addition; flagged for visibility — Documented.

## Applied status

| Learning | Status |
|---|---|
| 1. Gate auto-fire on non-empty transcript | Applied — TranscriptionPanel.tsx + 2 specs (pre-merge) |
| 2. Default MSW handlers for analyse/transcription | Applied — web/src/test/handlers.ts |
| 3. Merge gate: latest deploy (not `--status completed`) + PR CI green | Applied — CLAUDE.md guardrail + step 11 + memory |
| 4. Use isolated worktree for commits when sessions share the checkout | Applied — this Scribe commit; documented |
| 5. Stylist skipped for styled-to-match micro-change | Documented — judgment call |
