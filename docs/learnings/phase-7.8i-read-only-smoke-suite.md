# Learnings: Slice 7.8-I — Read-only smoke suite

---

- **Smoke test error-path assertions should use concrete valid payloads, not null, to pin the error source.** The initial `PATCH /notes/{id}/date` test used `{"date":null}`. A null date is a valid "clear the date" intent and could return 400 if input validation is ever added before the command handler, making the 404 non-deterministic. Hawk caught this. Using `"date":"2099-01-01"` ensures the 404 comes unambiguously from the missing note, not from payload rejection. **Action:** Add to the smoke test authoring rule: error-path tests must use well-formed payloads so the error source is unambiguous — Done (fix applied in same session before merge).

- **No permission audit entries from this slice.** `settings.local.json` already has full `Bash(*)`/`PowerShell(*)` coverage. **Action:** None needed.

- **Hawk at 46k for a 2-file test-only PR is high relative to the change size.** Hawk loaded all five handler files to verify assertion correctness, which is thorough but expensive when the assertions are self-evidently correct (HTTP status code + top-level array property name). For future test-only PRs with read-only smoke assertions, Hawk can scope reads to only the handler files exercised by the new specs. **Action:** TODO — add a note to Hawk's PR review guidance: for test-only changes, verify assertions against only the handlers they call, not the full handler surface.

## Applied status

| Learning | Status |
|---|---|
| 1. Error-path payloads must be well-formed | Applied — fix committed before merge (PR #60, commit 08100f4) |
| 2. No new permission entries | Applied — nothing to change |
| 3. Hawk scope for test-only PRs | TODO — add to Hawk review guidance |
