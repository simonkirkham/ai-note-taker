# Token Usage Log

Approximate tokens per slice. Recorded by Scribe at slice end; rounded to nearest 1 000. `Pip` folds Breaker + implementation + orchestration; `Hawk` folds all review rounds (the recurring spike). One row per slice; full per-agent breakdowns are in git history.

Recurring cost drivers and their pre-emptions live in [token-optimisation-playbook.md](token-optimisation-playbook.md) — add new avoidable costs there, not as prose here.

| Slice | Total | Pip | Hawk | Dominant cost driver |
|-------|------:|----:|-----:|----------------------|
| 3-A Add action items | 183k | 95k | 35k | First cross-aggregate slice; context compaction; 2 Hawk rounds |
| 3-B Complete/reopen | 86k | 55k | 8k | Pure extension; no Hawk rework |
| 3-C View open todos (home) | 113k | 62k | 6k | First cross-projection; layer-split kept Pip under 65k |
| 3-D Complete todos (home) | 40k | 20k | 4k | No new backend; 5 files |
| 3-E Delete action item | 55k | 28k | 5k | Extension; layer-split |
| 4-A Settable note date | 76k | 40k | 5k | First Phase 4; doc-fix pass + layer-split |
| 4-B Note layout redesign | 19k | 6k | 3k | Pure frontend |
| 4-C Implicit action add | 14k | 5k | 3k | Minimal frontend; lightest Phase 4 |
| 4-D Persistent sidebar | 18k | 8k | 3k | Pure frontend |
| 4-E Note summary cards | 82k | 53k | 6k | Largest Phase 4; new projection (9 handlers); 3 must-fix |
| 5-A B1 Add tags | 32k | 18k | 4k | In-flight domain; projection fixes |
| 5-A/B B2 Tags frontend | 11k | 3k | 1k | Pure frontend; pre-scaffolded |
| 5-C B1 TagIndex + GET /tags | 24k | 16k | — | Backend-only; followed FolderTree pattern |
| 5-C B2 Tag filter bar E2E | 43k | 40k | — | 3 deploy failures (Playwright race + eventual consistency) |
| 5-D B1 Create/browse folders | 29k | 18k | 2k | New aggregate; well-bounded |
| 5-D B2 Folders frontend | 23k | 12k | 2k | Pure frontend wire-up |
| 5-M Date defaults to today | 31k | 12k | 4k | Frontend-only |
| 5-EFGHIJKL Folder ops | 350k | 200k | 140k | 8 sub-slices in one PR; started on main not worktree; 2 Hawk rounds |
| 6 Upgrade to .NET 10 | 68k | 38k | 10k | CI failures (stale net8 refs); 2 Hawk rounds |
| 6.5-B Vitest scaffold | 67k | 20k | 35k | vitest lock-file Node-version desync |
| 6.5-C Home component tests | 70k | 55k | 10k | 2 blocking main-deploy failures (ConsistentRead, empty-string) |
| 6.5-D Note-view component tests | 50k | 35k | 10k | 2 Hawk rounds; stuck CI runner |
| 7-A Base editor + markdown | 147k | 45k | 77k | 2 Hawk rounds; stale-closure bug |
| 7-B Heading discussed + panel | 117k | 45k | 50k | 2 Hawk rounds |
| 7.5 Folder UX + Lambda perf (A–F) | 278k | 180k | 75k | 6 slices, 2 sessions; 7.5-F 2 Hawk rounds |
| 7.8-A Production pipeline | 5k | — | — | Manual setup; no agents |
| 7.8-G Domain event dispatcher | 129k | 20k | 104k | 2 Hawk rounds; soft-delete-timestamp bug |
| 7.8 Note-screen UX (B–F) | 320k | 215k | 95k | 5 slices one session; multiple 2-round reviews |
| 7.8-I Read-only smoke suite | 76k | 25k | 46k | Hawk read all 5 handlers for a 2-file PR |
| 7.8-H Human-readable URLs | 204k | 185k | 12k | 7 successive deploy failures |
| 8-A CDK + CORS wiring | 99k | 20k | 65k | 2 Hawk rounds; CORS assertion mismatch |
| 8-B Google Sign-In (frontend) | 155k | 65k | 70k | 2–3 Hawk rounds; OAuth state + E2E bypass |
| 8-B fixes Backend token + layout | 124k | 40k | 79k | 2 post-merge prod bugs (client_secret required) |
| 8-C/D JWT auth + isolation | 233k | 180k | 25k | IDOR gap post-merge (7 commits); compaction |
| Hotfix Auth token persistence | 21k | 18k | — | React effect-ordering race |
| 9-B Calendar API pass-through | 145k | 95k | 45k | 2 Hawk passes; Google SDK edge cases |
| 9-C NoteLinked + projection | 189k | 85k | 96k | 2 Hawk passes (Task.WhenAll swallow, ct) |
| 9-D One-click note from meeting | 180k | 85k | 75k | 2 Hawk rounds (user-isolation); compaction |
| 9-E Reminder hook + banner | 92k | 52k | 35k | 2 Hawk passes (timer churn) |
| 9-F Next-occurrence note | 135k | 50k | 80k | 2 Hawk rounds (6 findings) |
| 9-G CDK CalendarLinkIndex | 73k | 12k | 44k | Hawk 60% (SSM IAM negative test) |
| Hotfix TRANSCRIBE_ROLE_ARN 503 | 99k | 95k | — | 3 failed fix deploys; stale-alias root cause |
| Hotfix 9-F title + stub | 125k | 55k | 65k | 2 Hawk passes + 3 failed deploys (merge order) |
| 10-B Live transcript | 374k | 230k | 134k | 2 Hawk rounds + compaction + lint hotfix |
| 10-C Persist transcript | 222k | 120k | 98k | 2 Hawk passes + lint hotfix |
| 10-D Manual analysis (Bedrock) | 371k | 250k | 86k | Compaction mid-Pip + 2 Hawk rounds |
| 10-E Auto-analysis on stop | 144k | 85k | 47k | WSL suite + merge-gate incident |
| 10-F Capture remote participants | 172k | 90k | 73k | bin/obj context dump + 1 Hawk round-trip |
| 10-G Eval harness + prompts | 387k | 250k | 99k | Re-cut drifted scaffold; nightly-no-op bug caught |
| 10-I Record TagsSuggested | 125k | 70k | 46k | Clean backend; ref reads amortise across phase |
| 10-J Tag feedback projection | 188k | 120k | 57k | Meatier; dead-dispatcher discovery; parity fix |
| 10-K Record ActionItemsSuggested | 110k | 60k | 41k | Mechanical copy of 10-I |
| 10-L Action-item feedback projection | 207k | 130k | 65k | Cross-stream rebuild-ordering design |
| 10-M Stamp modelId/promptVersion | 273k | 80k | 120k | Event-versioning; Hawk traced every consumer ×2 |
| 10-N Migrate to Converse API | 224k | 70k | 109k | 2 Hawk rounds; behaviour-identical transport swap |
| MPI-2/10-P Ship analysis@v5 | 240k | — | 52k | eval-run; git-collision recovery (~55k) |
| 11-A Tag autocomplete | 137k | 55k | 73k | 2 Hawk passes; combobox a11y |
| 11-C Delete blank note on cancel | 103k | 25k | 75k | 2 Hawk passes; unawaited-Promise |
| 11-D Token expiry + silent refresh | 140k | 88k | 47k | Pip: fake-timer + findByRole iteration |
| 11-F Adaptive action buttons | 112k | 25k | 82k | 2 Hawk passes; predicate-arm test gap |
| 11-G Fix 401s in active sessions | 122k | 45k | 72k | 2 Hawk passes; jwtExpired inversion |
| 11-H Fix note-not-deleted on discard | 53k | 20k | 30k | Post-merge tsc error (prop signature) |
| 12-E + 12-H Alarms + unified errors | 372k | 137k | 95k | Parallel on shared file + deploy-break recovery |
| 12-F Frontend monitoring (RUM) | 196k | 95k | 45k | Plan agent pre-resolved Cognito → first-pass Hawk |
| 12-G Observability runbook + queries | 198k | 100k | 98k | Docs+queries verified vs real prod logs; 2 Hawk rounds |
| 16-A Browse meetings by date | 239k | 70k | 83k | End-to-end slice; Hawk traced full path |
| 17 Link note to meeting (A+B) | 335k | 125k | 95k | 2 slices one session; Scout docs landed mid-pipeline |
| 18-A Draft store + endpoints | 315k | 95k | 60k | Data-loss scare forensics + docs-to-main race |
| 18-B Frontend autosave + recovery | 215k | 70k | 80k | Concurrent 19-A api-split merge mid-build |
| 18-C Continue a transcript | 145k | 55k | 55k | Single-pass; Hawk caught stale-seed replace-on-2nd-Continue |
| 19-A Split api.ts into modules | 380k | 70k | 50k | Audit fan-out (~215k, amortises across Phase 19) |
| BUG-1 Blank screen on 401 | 163k | 110k | 44k | Merge/deploy orchestration vs fast-moving main |
| BUG-2 favicon 404 | 37k | (prior) | 28k | Recovery slice; trivial frontend fix |
| BUG-3/4/5 Backend defect sweep | 233k | 120k | 95k | 3 bugs one session; up-front backend explore |
| BUG-11 Session refresh-token flow | 214k | 55k | 62k | Cookie redesign; Hawk caught 30-day residual |
| CHANGE-4 To-do row wrapping | 105k | 60k | 37k | Recovery + 2 full-suite runs |
| CHANGE-5/6/7 Parallel minor batch | 536k | 244k | 112k | Parallel shared-file (App.css); orchestration ~180k |
| CHANGE-8/9 Sequential minor pair | 209k | 100k | 69k | Sequenced → zero conflict; cost was wall-clock |
| CHANGE-10 Home refinement | 164k | 70k | 40k | 3 prototype rounds (subjective brief) |
| CHANGE-11 Preview pull-out »↔« | 100k | 60k | 32k | Prop-threading + toggle |
| CHANGE-12 Notes divider/alignment | 70k | — | — | CSS tweak; backlog numbering collision |
| CHANGE-13 Next-occurrence control | 216k | 95k | 47k | Reuse-in-new-location; self-review caught 2 bugs |
| CHANGE-14 Rename audio toggle | 90k | 16k | 33k | One-line copy; smallest slice; Hawk is the floor |
| tech-remove-dead-dispatcher | 170k | 32k | 55k | Dead-dispatcher cleanup; Hawk coverage matrix |
| 20-A TanStack foundation + todos | 175k | 115k | 57k | Inherited a near-complete worktree (prior session); cost was verification + flaky vitest segfault retries, not authoring |
| 20-B Folders (tree) | 360k | 290k | 59k | Two mid-build rebases (21-A router, then 22-A/BUG-12) onto shared App.tsx + a `git rebase --quit` detached-HEAD recovery; explore+spec+impl in one session |
| 20-D Actions + tag index | 330k | 240k | 88k | Two domains, 5 components, 4 hooks; component-only (no App.tsx → one clean rebase); Hawk round on test coverage (rollback tests + prove temp-id swap) |
| 20-C Note cards / list | 470k | 330k | 95k | Biggest App.tsx consolidation (unify cards + useNotes, delete useNotes); post-merge E2E regression (tag-invalidation churn + fire-and-forget setNoteDate) → fix-forward PR #195 (red main). E2E only catches it after merge |
| 20-F Meetings | 250k | 175k | 61k | Two date-keyed queries cleanly preserve the Phase 16 reminders-vs-browsed decoupling; staleTime baked into the hook so the no-refetch test pins it; clean deploy+E2E (20-C lessons applied) |
| 21-A Router foundation + note/home URLs | ~340k | ~280k | 61k | Spike: two avoidable rounds — react-router-dom/Vitest vmThreads CJS-.mjs debug, then a mid-slice 20-A merge that broke PR-merge CI and forced a re-verify. Authoring itself was small. |
| 22-A Search read model + fuzzy endpoint | ~330k | ~255k | 75k | Backend slice; Explore map + single Pip pass (impl ~183k); Hawk caught O(user-notes) write-path scan → point-get. No spike. |
| 22-B Home search bar | ~220k | ~150k | 53k | Frontend; built in parallel w/ 22-A deploy; search kept in ListView (zero App.tsx edit) dodged the 20-B parallel conflict; merged main pre-PR; Hawk clean (3 nits). |
| 21-B Folder & sub-folder URLs | ~200k | ~150k | 47k | Clean single pass on top of 20-B's TanStack folders; Hawk approved first round (3 nits). One self-fixed regression (URL leak across tests → global reset) + a flaky eventstore CI rerun. No spike. |
| 21-C Deep-link edge cases | ~210k | ~165k | 44k | Closes Phase 21. Single pass; Hawk approved first round (3 optional nits, none applied). Auth-flow investigation (OAuth stash/restore) + new E2E journey. No spike. |
| 22-C Highlight matched terms | ~200k | ~150k | 43k | Backend (matchedTerms) + frontend (Highlight) single pass; Hawk approved first round (4 optional nits). Cost tail: NoteCard.tsx conflict with parallel 20-C → merge+resolve, and a false-green `gh pr checks --watch` (only CodeRabbit ran on the conflicting branch). |
| 20-E Note detail | ~640k | ~500k | 120k | **Spike — parallel-driver collision.** Built the slice twice: PR #198 against a stale local `phase-20.md` (seed-state approach), discovered 20-F + an authoritative draft-pattern 20-E spec were already on `origin/main`, threw it away, rebuilt as PR #199 off current main. Root cause: never `git fetch`ed before reading the plan. Both Pip passes were otherwise clean; Hawk approved each first round. See [phase-20e-note-detail](learnings/phase-20e-note-detail.md). |
| 24-A Bounded rebuild writes | ~280k | ~200k | ~80k | Backend single pass; Explore recon + one Pip pass (BoundedWrites helper + handler + 7 tests). Hawk REQUEST CHANGES on the under-tested OCE/timeout arm (the real 5s-timeout case) → fix → approve. No spike. See [phase-24a-bounded-rebuild-writes](learnings/phase-24a-bounded-rebuild-writes.md). |
| 19-D Context provider perf | ~170k | ~130k | ~40k | Small frontend memoisation slice; one clean Pip pass, Hawk approved first round (applied 1 of 2 optional nits). Cost tail = triaging 4 flaky `TagsJourney` E2E deploy re-runs (pre-existing flake, confirmed change-independent → routed to technical-improvements). No spike. See [phase-19d-context-provider-perf](learnings/phase-19d-context-provider-perf.md). |
| 20-G Cleanup + 19-H backoff | ~260k | ~190k | ~46k | Closes Phase 20. apiFetch transient-read backoff (subsumes 19-H) + dead `listNotes` removal; single Pip pass. Turning retry on for PUT/DELETE broke 6 optimistic-rollback tests → narrowed to GET/HEAD only (the correct line — see learnings); Hawk approved first round (4 optional nits). Cost tail = a lost-commit recovery (concurrent commit + push-waiter race → `git reset` reflog) and a main-deploy `TagsJourney` E2E flake gating the merge. No spike. See [phase-20g-cleanup](learnings/phase-20g-cleanup.md). |
| 24-B Upsert-and-reconcile | ~430k | ~290k | ~125k | Multi-store change: 5 new methods × (interface+Dynamo+double) + handler reconcile + 4 tests. Explore recon corrected one wrong conclusion (search tombstone direction). 2 Hawk rounds (~80k+43k): unpaginated reconcile scans + a tombstone test that passed trivially. No spike (breadth, not rework). See [phase-24b-upsert-reconcile](learnings/phase-24b-upsert-reconcile.md). |
| BUG-14 + E2E flake saga | ~470k | ~330k | ~85k | Two PRs on one thread: #203 (E2E tag-pill 15s→45s, **wrong** cold-start-latency diagnosis) then deploy #493 failed *with 45s applied* → re-diagnosed as a real optimistic-update race (multi-tag, note-in-flight) → #205 (reproduce-then-fix in `useTagMutations` + revert #203). Cost tail = the misdiagnosis loop + ~6 deploy/E2E watch cycles. Hawk approved both first round. Lesson: a near-deterministic "never appears" E2E timeout is a missing render, not latency — don't raise the timeout. See [phase-bugs#bug-14](phases/phase-bugs.md). |

## Scribe append format

Add one row above per completed slice. `Total` / `Pip` (Breaker+impl+orchestration) / `Hawk` (all rounds) / one-line dominant driver.

- A **spike** = any slice >2× the comparable recent slice, or a Hawk total >2× Pip. Flag it for `process-improvements`.
- If the slice surfaced a *new* avoidable cost, add a row to [token-optimisation-playbook.md](token-optimisation-playbook.md) — do not write a prose block here.
