# Learnings: 10-B Live transcript

- Lint not re-run after the second fix commit allowed a `prefer-const` error (`done` never reassigned after `_endStream` was removed) to escape to CI, requiring a post-merge hotfix commit to main. **Action:** Add "re-run `npm run lint` after every fix commit before pushing" as an explicit step in the Pip pre-push checklist in the frontend-ui-engineering skill — Done.

- Two Hawk rounds (six findings) were needed; five were preventable: try/catch for `AmazonSecurityTokenServiceException`, deprecated `ScriptProcessorNode`, CSS class not wired to component element, time-dependent expiration in fakes, and a weak CDK trust-policy assertion. **Action:** Add "for every new AWS SDK call, add a catch for the service-specific exception type mapping to 503" to the incremental-implementation skill — Done.

- Deprecated `ScriptProcessorNode` was used in `useTranscription.ts` without a comment noting it was deprecated. This is a pattern that Hawk reliably catches but that Pip can catch first. **Action:** Add a note to `frontend-ui-engineering` SKILL.md: "avoid `createScriptProcessor` — use `AudioWorkletNode` with a data URL or static asset worklet" — Done.

- CSS selector `.actions-section` was added to `App.css` but the corresponding `className="actions-section"` was missing from the `NoteView.tsx` JSX that wraps `<ActionsSection>`. The mismatch was invisible locally (component renders fine without the class). **Action:** Add to Pip's pre-PR self-check: "for every new CSS class added, confirm the matching `className` prop exists in a rendered element" — Done.

- `FakeStsCredentialService.FakeCredentials.Expiration` was initialised to `DateTimeOffset.UtcNow.AddMinutes(15)` — a time-dependent value that makes the static fake field fragile (different value depending on when tests run). **Action:** Add to test-driven-development SKILL.md: "fake credential/token fixtures must use far-future literal dates (e.g. 2099-01-01), not `UtcNow + offset`" — Done.

- The `_endStream` closure variable in the Transcribe SDK mock was marked as unused (`void _endStream`) from the start, indicating the design for test-controlled stream termination was never wired up. Hawk caught this in Round 2 as dead code. **Action:** None — the correct fix (remove unused closures immediately) is already implied by the standard no-dead-code rule. Pattern is noted for awareness.

- Node 20 / Node 24 npm lock file mismatch (existing CLAUDE.md guardrail). The rebase with `package-lock.json` regenerated with Node 20 resolved this correctly. No new action needed — guardrail already in place.

## Applied status

| Learning | Status |
|---|---|
| 1. Re-run lint after every fix commit | Applied — added to `frontend-ui-engineering` SKILL.md pre-push checklist |
| 2. Catch service-specific SDK exception type | Applied — added to `incremental-implementation` SKILL.md AWS service call checklist |
| 3. Avoid `createScriptProcessor`, use `AudioWorkletNode` | Applied — added note to `frontend-ui-engineering` SKILL.md |
| 4. CSS class must have matching JSX `className` | Applied — added to `frontend-ui-engineering` SKILL.md pre-PR self-check |
| 5. Far-future literal dates in fakes | Applied — added to `test-driven-development` SKILL.md |
| 6. Dead code (`void _endStream`) | Documented — no separate action; covered by standard no-dead-code practice |
| 7. Node lock file mismatch | Documented — existing CLAUDE.md guardrail already covers this |
