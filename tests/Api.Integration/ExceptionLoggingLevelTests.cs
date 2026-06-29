using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using EventStore;
using EventStore.Projections;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// TI-38: an exception that LoggingConfig.Map turns into a non-500 (409/404/…) is an
// expected business outcome and must produce NO Error-level log line — only the existing
// Warning. A genuine 500 must still log at Error exactly once. Previously ASP.NET's
// ExceptionHandlerMiddleware logged every escaped exception at Error before our handler
// re-mapped it, so mapped-to-409/404 exceptions double-logged (one Error, one Warning).
public sealed class ExceptionLoggingLevelTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;

    private const string FrameworkExceptionHandlerCategory =
        "Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddleware";

    [Fact]
    public async Task MappedWriteContention_LogsWarningOnly_NoError()
    {
        var captured = new CapturingLoggerProvider();
        var store = new ConflictingEventStore();
        var client = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton<ILoggerProvider>(captured);
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(sp => ApiFactory.BuildSyncProjectingStore(sp, store));
        })).CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteId = await CreateNoteAsync(client);

        store.ConflictsRemaining = int.MaxValue;
        var resp = await client.PatchAsync($"/notes/{noteId}/title",
            new StringContent("{\"title\":\"Renamed\"}", Encoding.UTF8, "application/json"));

        // BUG-27: exhausted append-retry contention maps to a retriable 503, logged at Warning
        // (not Error) — an expected, recoverable conflict must not pollute the ops error log.
        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("write contention, retry", body.GetProperty("error").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("correlationId").GetString()));
        Assert.True(resp.Headers.Contains(LoggingConfig.CorrelationIdHeader));

        Assert.DoesNotContain(captured.Entries, e => e.Level == LogLevel.Error);
        Assert.DoesNotContain(captured.Entries,
            e => e.Category == FrameworkExceptionHandlerCategory);
        Assert.Contains(captured.Entries,
            e => e.Level == LogLevel.Warning && e.Message.Contains("WriteContentionException"));
    }

    [Fact]
    public async Task GenuineServerFault_LogsErrorExactlyOnce()
    {
        var captured = new CapturingLoggerProvider();
        var client = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton<ILoggerProvider>(captured);
            s.RemoveAll<INoteTitleListStore>();
            s.AddSingleton<INoteTitleListStore, ThrowingNoteTitleListStore>();
        })).CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var resp = await client.GetAsync("/notes");

        Assert.Equal(HttpStatusCode.InternalServerError, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("internal server error", body.GetProperty("error").GetString());
        Assert.True(resp.Headers.Contains(LoggingConfig.CorrelationIdHeader));

        var errorLines = captured.Entries.Where(e => e.Level == LogLevel.Error).ToList();
        Assert.Single(errorLines);

        // Symmetric to the conflict test: a genuine 500 must NOT also emit the Warning
        // line reserved for expected (mapped non-500) outcomes.
        Assert.DoesNotContain(captured.Entries,
            e => e.Level == LogLevel.Warning && e.Message.Contains("Request failed"));
    }

    // The body has already begun streaming when the exception is thrown, so the response
    // status/headers/body are committed and cannot be rewritten. A genuine server fault on
    // that path must still log at Error exactly once (never silently swallowed) — the only
    // guarantee left once the body can't be replaced.
    [Fact]
    public async Task GenuineServerFault_AfterResponseStarted_StillLogsErrorOnce()
    {
        var captured = new CapturingLoggerProvider();
        var client = new ThrowAfterResponseStartedFactory(captured).CreateClient();

        // The body is already committed when the fault is thrown, so WriteMappedResponseAsync
        // takes the HasStarted early-return: it cannot rewrite the response, only log.
        try
        {
            await client.GetAsync(ThrowAfterResponseStartedFactory.Path);
        }
        catch (Exception)
        {
            // Some hosts surface the post-start fault as a transport error to the client;
            // either way the only contract we assert is the server-side Error log below.
        }

        var errorLines = captured.Entries.Where(e => e.Level == LogLevel.Error).ToList();
        Assert.Single(errorLines);
        Assert.DoesNotContain(captured.Entries,
            e => e.Level == LogLevel.Warning && e.Message.Contains("Request failed"));
    }

    private static async Task<string> CreateNoteAsync(HttpClient client)
    {
        var create = await client.PostAsync("/notes", null);
        return (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }
}
