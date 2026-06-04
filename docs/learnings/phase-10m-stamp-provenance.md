# Learnings: 10-M Stamp modelId / promptVersion on the suggestion events

- Versioning a *previously-unversioned* event is more than adding a v2 type: the `EventDeserializer` arm must be narrowed from the wildcard `(nameof(X), _)` to an explicit `(nameof(X), 1)` **plus** a new `(nameof(X), 2)`, and you must confirm every historical write of that type used `InitialEventVersion = 1` (else the narrowed v1 arm silently throws on an old event). Hawk verified the latter held here. **Action:** add an event-versioning guardrail to `CLAUDE.md` capturing this two-part rule — **Done** (guardrail added under the "version it" rule in the Guardrails section).
- The "persist a `vN` domain event under the **v1 logical** `EventType` name at `EventVersion N`" idiom now lives in `NoteCommandHandler.ToEnvelopes` for three events (`ContentEdited`, `TagsSuggested`, `ActionItemsSuggested`) as an inline `switch`. **Action:** leave as-is — three arms don't justify a mapping registry under the no-premature-abstraction rule; revisit if a fourth versioned event lands — **Documented**.
- Adding one field (`PromptVersion`) to a provenance row touched four sites that must stay in lockstep: the projection's `*Provenance` record, the DynamoDB store, the in-memory test double, and the rebuild handler's `PutProvenanceAsync` call. The existing "grep all call sites before opening the PR" guardrail caught all four; no miss. **Action:** none beyond the existing guardrail — **Documented**.
- `EventStore.Integration` (Testcontainers + DynamoDB Local) cannot run locally without Docker, so the v2 round-trip through real serialisation was validated only by the CI `eventstore` job (which passed). **Action:** none — environment constraint; the CI job is the standing safety net for this layer — **Documented**.
- Scribe collided with the human's in-flight restructuring of the exact files it updates (`phase-10.md` adds 10-O/10-P, `roadmap.md` reworked) in the shared main checkout. Resolved via the scribe skill's documented fresh-worktree-off-`origin/main` fallback plus an explicit human decision to push the full status update. **Action:** none — the skill already prescribes this fallback; the human will reconcile their local copy on next pull — **Documented**.

## Applied status

| Learning | Status |
|---|---|
| 1. Event-versioning: narrow the deserializer `_` arm + verify historical write version | Applied — guardrail added to `CLAUDE.md` Guardrails section (after the "version it" rule) |
| 2. `ToEnvelopes` versioned-persist switch (3 arms) | Documented — no abstraction yet (no-premature-abstraction); revisit at 4th event |
| 3. Provenance-field change touches 4 lockstep sites | Documented — existing grep-all-call-sites guardrail covered it |
| 4. EventStore.Integration is CI-only without local Docker | Documented — CI `eventstore` job is the safety net |
| 5. Scribe vs human WIP on phase-10/roadmap | Documented — scribe skill's fresh-worktree fallback handled it |
