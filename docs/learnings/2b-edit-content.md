---
slice: 2-B
title: Write and save note content (EditContent command)
date: 2026-05-06
---

# Learnings: 2-B — Write and save note content

## What was inefficient or went wrong

- **Frontend still not delivered.** The backend command (`EditContent`, `PUT /notes/{noteId}/content`) was implemented and reviewed, but the frontend blur-to-save wiring was not done. The slice remains `In Progress`. The pipeline treated the backend as the deliverable, when the user-facing value ("type meeting notes and have them saved automatically") requires the frontend too.

- **Scribe not triggered after backend merge.** No learnings were written for 2-B after Pip merged. The workflow continued to 2-A frontend work and then doc/tooling tasks without Scribe running.

- **Workflow role evolution happened mid-phase.** The Stylist role, Scribe's README ownership, and the `agent-roles.md` Scribe entry were all added during phase 2 work rather than before it started. This is expected for a learning project, but it meant the pipeline was being run against an incomplete definition.

- **Missing infrastructure not caught before the slice.** The `notetaker-proj-notedetail` DynamoDB table was absent from `docker-compose.yml` and `launchSettings.json`. This was a silent local-run breakage — `dotnet run` would throw `InvalidOperationException` at startup. It was only noticed during a doc review session, not during 2-B implementation.

- **dev.sh didn't exist.** There was no single command to start the full local stack. Contributors had to know the three-step manual sequence (docker compose, dotnet run, npm dev) and the correct env var values. This friction was also carried silently from phase 1.

## Suggested process improvements

- **Pip's "done" gate must include frontend acceptance.** Pip should not open a PR for a user-facing slice until the blur-to-save (or equivalent frontend interaction) is wired up and the relevant E2E journey test passes.

- **Local-dev smoke test should be part of Pip's validation sequence.** Before opening a PR, Pip should verify `bash dev.sh` starts cleanly and the app loads. This would have caught the missing table and missing env var before they became a doc-review discovery.

- **Scribe owns `docker-compose.yml`, `launchSettings.json`, and `dev.sh` review** for any slice that adds a new table or env var. The pattern "table added to CDK but not to local dev" should be Scribe's checklist item: compare CDK table names to docker-compose tables and launchSettings env vars.

- **Role additions (Stylist, Scribe in agent-roles.md) should be a Scout output**, not discovered mid-slice. When Scout identifies a gap in the pipeline definition, it should file a separate doc-only slice rather than leaving it to be fixed ad hoc.

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| `EditContent` method name collides with `Domain.Notes.EditContent` type — compiler error without disambiguation | `src/Api/Handlers/NoteHandlers.cs` | Pip: use a `using` alias (`using EditContentCmd = ...`) whenever a handler method shares a name with a domain type |
| `PutContent_ThenGetNote_ReturnsUpdatedContentAndBumpsLastModifiedAt` read `lastModifiedAt` only after the PUT, so it was not actually asserting it had changed | `tests/ApiIntegration/EditContentTests.cs` | Breaker: snapshot before-state for any "bumps X" assertion; the test name implies a before/after comparison |
