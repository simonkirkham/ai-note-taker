using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EventStore.Projections;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

public sealed class CorrelationIdTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string CorrelationIdHeader = "x-correlation-id";
    private const string TraceIdHeader = "x-amzn-trace-id";

    [Fact]
    public async Task SuccessfulResponse_CarriesCorrelationIdHeader()
    {
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/health");

        resp.EnsureSuccessStatusCode();
        Assert.True(resp.Headers.TryGetValues(CorrelationIdHeader, out var values));
        Assert.False(string.IsNullOrWhiteSpace(values!.Single()));
    }

    [Fact]
    public async Task SuccessfulResponse_CarriesTraceIdHeader()
    {
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/health");

        resp.EnsureSuccessStatusCode();
        Assert.True(resp.Headers.TryGetValues(TraceIdHeader, out var values));
        Assert.False(string.IsNullOrWhiteSpace(values!.Single()));
    }

    [Fact]
    public async Task Response_EchoesInboundTraceId()
    {
        var client = factory.CreateClient();
        const string inbound = "Root=1-5e1b4151-5ac6c58dc39a6e8d5e3a1234";

        var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add(TraceIdHeader, inbound);
        var resp = await client.SendAsync(request);

        resp.EnsureSuccessStatusCode();
        Assert.True(resp.Headers.TryGetValues(TraceIdHeader, out var values));
        Assert.Equal(inbound, values!.Single());
    }

    [Fact]
    public async Task UnhandledException_Returns500_WithCorrelationIdInHeaderAndBody()
    {
        // Swap in a projection store that throws so GET /notes surfaces an
        // unhandled exception, exercising the global 500 handler.
        var client = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<INoteTitleListStore>();
                services.AddSingleton<INoteTitleListStore, ThrowingNoteTitleListStore>();
            })).CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var resp = await client.GetAsync("/notes");

        Assert.Equal(HttpStatusCode.InternalServerError, resp.StatusCode);
        Assert.True(resp.Headers.TryGetValues(CorrelationIdHeader, out var headerValues));
        var correlationId = headerValues!.Single();
        Assert.False(string.IsNullOrWhiteSpace(correlationId));

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(correlationId, body.GetProperty("correlationId").GetString());
    }
}

// Powertools writes its JSON to Console.Out and reads the writer lazily on every line, so
// redirecting Console.Out for the duration of one request captures exactly what would be
// emitted to CloudWatch. That redirection is process-global, so this test lives in a
// collection marked DisableParallelization to keep any other test off the console while it
// runs.
[Collection(ConsoleCaptureCollection.Name)]
public sealed class CorrelationIdLoggingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string CorrelationIdHeader = "x-correlation-id";

    // BUG-8: the x-correlation-id value returned to the client must also be emitted as a
    // queryable `correlation_id` field on the request's log lines, otherwise a user (or a
    // 500 body) can quote an ID that cannot then be found in CloudWatch.
    [Fact]
    public async Task EmittedLogLine_CarriesCorrelationIdFieldMatchingHeader()
    {
        var client = factory.CreateClient();

        var capture = new StringWriter();
        var original = Console.Out;
        Console.SetOut(TextWriter.Synchronized(capture));
        HttpResponseMessage resp;
        try
        {
            // A successful command emits an Information "Command received" line — a
            // representative normal request, not just the error path.
            resp = await client.PostAsync("/folders",
                new StringContent("{\"name\":\"Logged folder\"}", System.Text.Encoding.UTF8, "application/json"));
        }
        finally
        {
            Console.SetOut(original);
        }

        resp.EnsureSuccessStatusCode();
        var correlationId = resp.Headers.GetValues(CorrelationIdHeader).Single();

        var loggedCorrelationIds = capture.ToString()
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(TryReadCorrelationId)
            .Where(id => id is not null)
            .ToList();
        Assert.Contains(correlationId, loggedCorrelationIds);
    }

    private static string? TryReadCorrelationId(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            return doc.RootElement.TryGetProperty("correlation_id", out var value)
                ? value.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // Obs-review 2026-06-30: the request log scope must carry the caller's identity — `sub`
    // (authenticated subject), `user_agent`, and `source_ip` — so an automated/unknown HTTP client
    // firing commands at the API can be identified in CloudWatch. The bearer token must NEVER be logged.
    [Fact]
    public async Task EmittedLogLine_CarriesCallerIdentity_AndNeverTheBearerToken()
    {
        const string userAgent = "ObsReviewProbe/9.9 (identity-test)";
        const string bearerSentinel = "SENSITIVE-BEARER-TOKEN-DO-NOT-LOG-abc123";
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        client.DefaultRequestHeaders.Add("User-Agent", userAgent);
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {bearerSentinel}");

        var capture = new StringWriter();
        var original = Console.Out;
        Console.SetOut(TextWriter.Synchronized(capture));
        HttpResponseMessage resp;
        try
        {
            resp = await client.PostAsync("/folders",
                new StringContent("{\"name\":\"Identity folder\"}", System.Text.Encoding.UTF8, "application/json"));
        }
        finally
        {
            Console.SetOut(original);
        }

        resp.EnsureSuccessStatusCode();
        var output = capture.ToString();

        // The authenticated request's log lines carry sub + user_agent, and the source_ip key is
        // always present (its value is empty under TestServer, which has no real peer connection).
        var identityLine = output
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(TryParseLine)
            .FirstOrDefault(e => e is { } line
                && line.TryGetProperty("sub", out var sub)
                && sub.GetString() == FakeCurrentUser.TestUserId);
        Assert.True(identityLine is not null, "no log line carried the authenticated sub");
        Assert.Equal(userAgent, identityLine!.Value.GetProperty("user_agent").GetString());
        Assert.True(identityLine.Value.TryGetProperty("source_ip", out _), "source_ip field missing");

        // The bearer token must never appear in ANY log line.
        Assert.DoesNotContain(bearerSentinel, output);
    }

    private static JsonElement? TryParseLine(string line)
    {
        try
        {
            return JsonDocument.Parse(line).RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class ConsoleCaptureCollection
{
    public const string Name = "ConsoleCapture";
}
