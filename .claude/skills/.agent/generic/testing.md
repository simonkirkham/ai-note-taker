# Testing — Principles

## Co-location

Place test files next to the source file they test (e.g. `index.test.ts` alongside `index.ts`). Do not create a separate `tests/` directory unless the project already uses one.

## What to Unit Test

- Pure logic — always unit test (parsing, normalisation, routing, calculations)
- External service calls — mock the client, assert the call parameters
- Infrastructure config — unit test the configuration values themselves

## What Not to Unit Test

- End-to-end invocation of deployed services — cover this with integration tests post-deploy
- Third-party library internals — test your usage of them, not their implementation
- Things that cannot fail independently — do not write tests that only pass because the mock always returns what you told it to

## Mocking

- Mock at the boundary of your code (external APIs, databases, file system)
- Assert on what was called and with what arguments — not just that no error was thrown
- Keep mocks minimal; only stub what the test actually exercises
- **Far-future dates in fakes**: credential/token fixtures that carry an expiration date must use a far-future literal (e.g. `new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero)`) — never `DateTimeOffset.UtcNow + offset`. A static readonly field is evaluated once at type-initialisation time; a time-relative value makes the fake fragile and can cause assertions to fail hours after the fact.

## Integration Tests

Integration tests run against a deployed environment, not locally. They exist to catch failures that unit tests cannot — misconfigured infrastructure, incorrect IAM permissions, real network behaviour.

- Do not try to replicate integration tests as unit tests
- If an integration test fails, the problem is likely in infrastructure or deployment config, not application logic

## Watch Mode

Use watch mode when iterating on a specific area — run the full suite before pushing.

## Test Diagnostics (xUnit)

When a test calls a real HTTP endpoint, failures are often silent — the assertion fails but you can't see what the API actually returned.

**Use `ITestOutputHelper` instead of `Console.WriteLine`.** xUnit's `Console.WriteLine` output is suppressed by default; `ITestOutputHelper` is always shown for failing tests.

Inject it alongside any fixture:

```csharp
public sealed class RenameNoteSpec(DeployedApiFixture fixture, ITestOutputHelper output)
```

Log key HTTP diagnostics in helper methods — at minimum the status code on both the happy path and the error path:

```csharp
private async Task<string> CreateNoteAsync()
{
    var response = await fixture.Client.PostAsync("notes", null);
    try
    {
        output.WriteLine($"POST /notes → {response.StatusCode}");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }
    catch (Exception ex)
    {
        output.WriteLine($"Failed to parse response: {ex.Message}, status: {response.StatusCode}");
        throw;
    }
}
```

Catch `Exception` (not a narrow type) when the purpose is diagnostic logging — you want to see the status code regardless of whether the failure is a `JsonException`, `HttpRequestException`, or something else.
