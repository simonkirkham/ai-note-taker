# Phase 6.5-A — Rename test projects

**Slice:** 6.5-A  
**Date:** 2026-05-14  
**PR:** #36

## What was done

Pure structural rename of all six test projects: directory, `.csproj` filename, C# namespace declarations, solution file entries, both CI workflow files, `CLAUDE.md`, and `docs/roadmap.md`. No behaviour changed.

| Old | New |
|-----|-----|
| `tests/Specs/` | `tests/Domain.Specs/` |
| `tests/EventStoreIntegration/` | `tests/EventStore.Integration/` |
| `tests/ApiIntegration/` | `tests/Api.Integration/` |
| `tests/InfraAssertions/` | `tests/Infrastructure.Assertions/` |
| `tests/Acceptance/` | `tests/Api.Smoke/` |
| `tests/E2E/` | `tests/Browser.E2E/` |

Also fixed a pre-existing test isolation bug: two empty-state assertions were sharing an `IClassFixture<ApiFactory>` instance with data-adding tests, causing ordering-sensitive CI failures.

## Learnings

### Namespace `sed` must cover both declarations and `using` statements

After `git mv`, a bulk `sed 's/namespace Specs\./namespace Domain.Specs./g'` updated declarations but missed `using Specs.*` references in the same files. Build failed with `CS0246: The type or namespace name 'Specs' could not be found`. Fix: a second pass `sed 's/using Specs\./using Domain.Specs./g'`. **Rule:** after a namespace rename, always grep for the old name as both `namespace OldName` and `using OldName` — they are different token positions.

### `IClassFixture<T>` scope is per class, not per test

xUnit's `IClassFixture<T>` gives one fixture instance shared across all tests in the class. Stores registered as `AddSingleton` in `ApiFactory` are therefore shared. When `GetTags_ReturnsEmptyWhenNoTags` ran alphabetically after `GetTags_NoteCountIncrementsForSameTag`, the in-memory tag store was non-empty and the assertion failed. The fix is mechanical: any test that asserts on a clean initial state must be its own `IClassFixture`-bearing class, so it gets a fresh factory. Single-test classes are fine and explicit about intent.

### Merge conflicts on structural refactors require taking main's structure, not a line blend

When a rename slice merges against a structural change on main (main had restructured `pr.yml` into three parallel jobs), a naive conflict resolution that blends both versions produces a broken file. The right resolution: identify which branch "owns" the structural decision (main's job-split was a deliberate CI improvement) and which owns the content decision (the slice's path renames), then take main's structure and apply the slice's changes inside it. Read the intent of each side before touching the conflict markers.

### Hawk's stale-path finding is a useful fast-follow list

Hawk's review surfaced old paths still present in skill files and phase docs. These don't break builds but mislead agents on future slices. Updating the immediately agent-facing files (`CLAUDE.md`, `docs/roadmap.md`, `.github/workflows/`) is the correct scope for the rename PR; skill files and historical phase docs are tracked as a follow-up without blocking the merge.
