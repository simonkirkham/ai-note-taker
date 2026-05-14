---
name: phase-6-upgrade-to-dotnet10
type: project
date: 2026-05-14
---

## What was built

Phase 6 upgrades all 10 projects in the solution from .NET 8 to .NET 10 (LTS → LTS, skipping non-LTS .NET 9) and updates the Lambda runtime constant in CDK from `DOTNET_8` to `DOTNET_10`. Delivered in two slices: 6-A (all csproj files + package bumps, local build gate, no AWS changes) and 6-B (CDK runtime constant, CI workflow files, and a pre-existing `Folder._exists` CS0414 build error fixed as a side effect).

## Key learnings

**Framework upgrades touch more files than just `.csproj`.** Three non-csproj files also contained .NET 8 references that needed updating: `aws-lambda-tools-defaults.json` (`"framework"` and `"function-runtime"` fields), `src/Infrastructure/NoteTakerStack.cs` (default asset path and `Runtime.*` constant), and both GitHub Actions workflow files (`dotnet-version`, `dotnet publish -o` path, Playwright script path). A grep for `net8.0` and `dotnet8` across all non-csproj files should be a mandatory gate at the end of any framework upgrade.

**NuGet cache can corrupt after a mass version bump.** After updating 10+ package versions simultaneously, `dotnet restore` succeeded but `dotnet build` failed with NETSDK1064 ("Package X was not found") for packages that restore output showed as restored. Fix: `dotnet nuget locals all --clear` then `dotnet restore`. The restore output always claimed success; only the build surface revealed the corruption.

**Testcontainers deprecated constructors require reading the source, not the docs.** `DynamoDbBuilder()` (parameterless) was marked `[Obsolete]` in Testcontainers.DynamoDb 4.11.0 — but the `DynamoDbBuilder.DynamoDbImage` constant it references was also deprecated (pointing at an old tag). The unambiguous fix was to write a one-file throwaway program that printed `DynamoDbBuilder.DynamoDbImage` at runtime to get the actual string value (`amazon/dynamodb-local:1.21.0`), then use that literal directly. Faster than reading changelogs or searching GitHub.

**`dotnet publish -q` hides real output.** The quiet flag causes MSBuild diagnostics to appear on stderr even when the exit code is 0, making the output look like errors. Removing `-q` gives readable, accurate output with no downside.

**Two-slice structure for a framework upgrade is worth the overhead.** 6-A (local build gate only, no AWS) and 6-B (CDK runtime + deploy) kept each PR small and reviewable in isolation. If 6-B had introduced a Lambda runtime regression, 6-A would have been unaffected on main. The extra PR is low cost relative to the reduced blast radius.

**InfraAssertions is the canonical regression guard for CDK changes.** Hawk correctly flagged that the `DOTNET_10` runtime constant had no assertion covering it — a future accidental revert to `DOTNET_8` would pass all tests. Adding `Lambda_RuntimeIsDotnet10` to `InfraAssertionsTests.cs` closes this gap. Any CDK constant change that is not covered by an InfraAssertions test is an invisible regression risk.
