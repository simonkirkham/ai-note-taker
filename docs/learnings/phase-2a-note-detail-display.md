---
slice: 2-A
title: Load and display note content
date: 2026-05-06
---

# Learnings: 2-A — Load and display note content

## What was inefficient or went wrong

- **Phase doc didn't exist.** There was no `docs/phases/phase-2.md` when work on 2-A began. The slice was implemented and marked `Done` without Scout ever producing the required phase file. The user had to point this out explicitly before the file was created.

- **Slice declared Done before the frontend existed.** The initial acceptance criteria were backend-only (projection, API endpoint). The frontend — the textarea, loading indicator, and `getNoteDetail` call — was missing. The slice was marked `Done` in the phase doc despite the visible part of the value ("users can open a note and see its content") being undelivered. This was only caught when the user asked directly.

- **Acceptance criteria were written as API contracts, not user behaviour.** The original criteria included items like "GET /notes/{id} returns 200" rather than "User opens a note — content is displayed." This made it possible to tick a box (backend works) without the user having gained anything. Criteria had to be rewritten after the fact.

- **Scribe was never triggered after this slice landed.** No learnings file was written, phase checkboxes were not marked, and no one called out the workflow gap until the user raised it during 2-B work.

## Suggested process improvements

- **Scout must produce `docs/phases/phase-N.md` before any code starts.** The hand-off is now enforced in `agent-roles.md` and `agent-workflow.md`, but this was missing when 2-A was built. Scout should be blocked from handing off to Breaker without the file committed.

- **Breaker should reject acceptance criteria written as HTTP contracts.** The Breaker hand-off checklist should include: "criteria describe what the user does and sees, not API status codes." If any criterion reads like an API test, Breaker sends it back to Scout before writing specs.

- **"Done" means the E2E test passes in a browser, not that the backend endpoint exists.** Pip should not mark a user-facing slice complete until the E2E journey test passes end-to-end, including the frontend.

- **Scribe must be explicitly named at each merge.** Pip's merge step should end with: "Scribe is now unblocked — please run Scribe for this slice." Without an explicit trigger, Scribe is silently skipped.

## Hawk review findings

*(No Hawk review was recorded for 2-A — the slice was completed outside the formal pipeline.)*
