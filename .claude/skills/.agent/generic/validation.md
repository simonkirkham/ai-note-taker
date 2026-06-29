# Validation — Pre-Push Principles

Always validate locally before pushing. Pipeline failures cost more time than local failures — the pipeline is not a substitute for local validation.

## Recommended Sequence

Run in this order. Each step must pass before moving to the next.

1. **Lint** — catch style and correctness issues
2. **Format check** — verify formatting without auto-fixing
3. **Typecheck** — catch type errors across all tsconfigs
4. **Test** — run all unit tests
5. **Build** — verify the full build succeeds end-to-end
6. **Bundle test** (if applicable) — verify the built artifact loads correctly

## Fixing Common Issues

- **Format check fails** — run the formatter to auto-fix, then re-check
- **Lint fails** — run auto-fix for mechanical issues; fix remaining issues manually
- **Typecheck fails** — identify which tsconfig scope owns the error (multiple configs = multiple scopes, errors are not interchangeable)
- **Build fails** — check build tool config and external dependencies; do not skip the bundle test

## Notes

- If a pre-push hook blocks you, fix the underlying issue — do not bypass the hook
- The pipeline runs the same sequence; a local failure and a pipeline failure are the same failure
- Fix everything locally before pushing; do not use the pipeline as a debugging tool
