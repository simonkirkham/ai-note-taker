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
    public async Task MappedConcurrencyConflict_LogsWarningOnly_NoError()
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

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("conflict", body.GetProperty("error").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("correlationId").GetString()));
        Assert.True(resp.Headers.Contains(LoggingConfig.CorrelationIdHeader));

        Assert.DoesNotContain(captured.Entries, e => e.Level == LogLevel.Error);
        Assert.DoesNotContain(captured.Entries,
            e => e.Category == FrameworkExceptionHandlerCategory);
        Assert.Contains(captured.Entries,
            e => e.Level == LogLevel.Warning && e.Message.Contains("ConcurrencyException"));
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
    }

    private static async Task<string> CreateNoteAsync(HttpClient client)
    {
        var create = await client.PostAsync("/notes", null);
        return (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }
}
