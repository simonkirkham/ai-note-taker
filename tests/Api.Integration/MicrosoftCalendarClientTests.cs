using System.Net;
using System.Text;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// Unit tests for the Microsoft Graph-backed calendar client (Phase 32-A).
// Drives a mocked HttpClient (token endpoint + Graph) and a fake refresh-token
// source, mirroring GoogleCalendarClient's SSM + invalid_grant heal behaviour.
public sealed class MicrosoftCalendarClientTests
{
    private const string TokenPath = "/oauth2/v2.0/token";

    private static MicrosoftCalendarClient Build(StubHandler handler, FakeRefreshTokenSource source)
    {
        Environment.SetEnvironmentVariable("MS_CLIENT_ID", "client-123");
        Environment.SetEnvironmentVariable("MS_TENANT_ID", "common");
        var http = new HttpClient(handler);
        return new MicrosoftCalendarClient(NullLogger<MicrosoftCalendarClient>.Instance, http, source);
    }

    private static string CalendarViewBody(string valueJson) =>
        $$"""{ "value": {{valueJson}} }""";

    private static string TokenOk(string accessToken) =>
        $$"""{ "access_token": "{{accessToken}}", "token_type": "Bearer", "expires_in": 3599 }""";

    private const string TokenInvalidGrant =
        """{ "error": "invalid_grant", "error_description": "AADSTS70000: token expired or revoked" }""";

    [Fact]
    public async Task GetEventsForDayAsync_MapsCalendarViewFieldsToCalendarEvents()
    {
        var value = """
        [
          { "id": "inst-1", "subject": "Test Meeting", "isAllDay": false, "isCancelled": false,
            "seriesMasterId": null,
            "start": { "dateTime": "2026-06-22T08:30:00.0000000", "timeZone": "UTC" },
            "end":   { "dateTime": "2026-06-22T09:00:00.0000000", "timeZone": "UTC" } },
          { "id": "inst-2", "subject": "Weekly Sync", "isAllDay": false, "isCancelled": false,
            "seriesMasterId": "series-9",
            "start": { "dateTime": "2026-06-22T13:00:00.0000000", "timeZone": "UTC" },
            "end":   { "dateTime": "2026-06-22T13:30:00.0000000", "timeZone": "UTC" } }
        ]
        """;
        var handler = new StubHandler((req, body) =>
            req.RequestUri!.AbsolutePath.EndsWith(TokenPath)
                ? Ok(TokenOk("access-AAA"))
                : Ok(CalendarViewBody(value)));
        var client = Build(handler, new FakeRefreshTokenSource("rt-1"));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.NotNull(result);
        Assert.Equal(2, result!.Count);

        Assert.Equal("inst-1", result[0].CalendarEventId);
        Assert.Equal("Test Meeting", result[0].Title);
        Assert.Equal(new DateTimeOffset(2026, 6, 22, 8, 30, 0, TimeSpan.Zero), result[0].StartTime);
        Assert.Equal(new DateTimeOffset(2026, 6, 22, 9, 0, 0, TimeSpan.Zero), result[0].EndTime);
        Assert.False(result[0].IsRecurring);
        Assert.Null(result[0].RecurringSeriesId);

        Assert.True(result[1].IsRecurring);
        Assert.Equal("series-9", result[1].RecurringSeriesId);
    }

    [Fact]
    public async Task GetEventsForDayAsync_SendsBearerTokenPreferUtcAndCalendarViewWindow()
    {
        HttpRequestMessage? graphReq = null;
        var handler = new StubHandler((req, body) =>
        {
            if (req.RequestUri!.AbsolutePath.EndsWith(TokenPath)) return Ok(TokenOk("access-BBB"));
            graphReq = req;
            return Ok(CalendarViewBody("[]"));
        });
        var client = Build(handler, new FakeRefreshTokenSource("rt-1"));

        await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.NotNull(graphReq);
        Assert.Contains("/me/calendarView", graphReq!.RequestUri!.AbsoluteUri);
        Assert.Contains("startDateTime=2026-06-22T00:00:00", graphReq.RequestUri!.AbsoluteUri);
        Assert.Contains("endDateTime=2026-06-23T00:00:00", graphReq.RequestUri!.AbsoluteUri);
        Assert.Equal("Bearer", graphReq.Headers.Authorization!.Scheme);
        Assert.Equal("access-BBB", graphReq.Headers.Authorization.Parameter);
        Assert.Contains(graphReq.Headers.GetValues("Prefer"), v => v.Contains("outlook.timezone=\"UTC\""));
    }

    [Fact]
    public async Task GetEventsForDayAsync_ExcludesCancelledInstances()
    {
        var value = """
        [
          { "id": "live", "subject": "Live", "isCancelled": false, "seriesMasterId": null,
            "start": { "dateTime": "2026-06-22T08:00:00.0000000", "timeZone": "UTC" },
            "end":   { "dateTime": "2026-06-22T08:30:00.0000000", "timeZone": "UTC" } },
          { "id": "gone", "subject": "Cancelled", "isCancelled": true, "seriesMasterId": null,
            "start": { "dateTime": "2026-06-22T09:00:00.0000000", "timeZone": "UTC" },
            "end":   { "dateTime": "2026-06-22T09:30:00.0000000", "timeZone": "UTC" } }
        ]
        """;
        var handler = new StubHandler((req, body) =>
            req.RequestUri!.AbsolutePath.EndsWith(TokenPath) ? Ok(TokenOk("a")) : Ok(CalendarViewBody(value)));
        var client = Build(handler, new FakeRefreshTokenSource("rt-1"));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.NotNull(result);
        Assert.Single(result!);
        Assert.Equal("live", result![0].CalendarEventId);
    }

    [Fact]
    public async Task GetEventsForDayAsync_GraphAccessDenied_ReturnsNull()
    {
        var handler = new StubHandler((req, body) =>
            req.RequestUri!.AbsolutePath.EndsWith(TokenPath)
                ? Ok(TokenOk("a"))
                : new HttpResponseMessage(HttpStatusCode.Forbidden)
                  {
                      Content = new StringContent(
                          """{ "error": { "code": "ErrorAccessDenied", "message": "Access is denied." } }""",
                          Encoding.UTF8, "application/json")
                  });
        var client = Build(handler, new FakeRefreshTokenSource("rt-1"));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.Null(result); // calendar_unavailable, NOT an empty list
    }

    [Fact]
    public async Task GetEventsForDayAsync_InvalidGrant_ReloadsTokenFromSourceAndRetriesOnce()
    {
        var source = new FakeRefreshTokenSource("rt-stale") { ReloadValue = "rt-fresh" };
        var handler = new StubHandler((req, body) =>
        {
            if (req.RequestUri!.AbsolutePath.EndsWith(TokenPath))
            {
                // The stale refresh token is rejected; the fresh one mints a token.
                return body.Contains("rt-fresh")
                    ? Ok(TokenOk("access-after-heal"))
                    : new HttpResponseMessage(HttpStatusCode.BadRequest)
                      { Content = new StringContent(TokenInvalidGrant, Encoding.UTF8, "application/json") };
            }
            return Ok(CalendarViewBody("""
                [ { "id": "x", "subject": "Healed", "isCancelled": false, "seriesMasterId": null,
                    "start": { "dateTime": "2026-06-22T08:00:00.0000000", "timeZone": "UTC" },
                    "end":   { "dateTime": "2026-06-22T08:30:00.0000000", "timeZone": "UTC" } } ]
                """));
        });
        var client = Build(handler, source);

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.NotNull(result);
        Assert.Single(result!);
        Assert.Equal("x", result![0].CalendarEventId);
        Assert.Equal(1, source.ForceReloadCount); // healed exactly once
    }

    [Fact]
    public async Task GetEventsForDayAsync_NoRefreshToken_ReturnsNullWithoutCallingGraph()
    {
        var handler = new StubHandler((req, body) =>
            throw new InvalidOperationException("No HTTP call should be made when there is no token."));
        var client = Build(handler, new FakeRefreshTokenSource(null));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetNextOccurrenceAsync_ReturnsNullUntil32B()
    {
        var handler = new StubHandler((req, body) => Ok(TokenOk("a")));
        var client = Build(handler, new FakeRefreshTokenSource("rt-1"));

        var result = await client.GetNextOccurrenceAsync("series-9", DateTimeOffset.UtcNow);

        Assert.Null(result);
    }

    private static HttpResponseMessage Ok(string json) =>
        new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, string, HttpResponseMessage> _respond;
        public StubHandler(Func<HttpRequestMessage, string, HttpResponseMessage> respond) => _respond = respond;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            return _respond(request, body);
        }
    }

    private sealed class FakeRefreshTokenSource : IMicrosoftRefreshTokenSource
    {
        private readonly string? _initial;
        public string? ReloadValue { get; set; }
        public int ForceReloadCount { get; private set; }

        public FakeRefreshTokenSource(string? initial) { _initial = initial; ReloadValue = initial; }

        public Task<string?> LoadAsync(bool forceReload)
        {
            if (forceReload) { ForceReloadCount++; return Task.FromResult(ReloadValue); }
            return Task.FromResult(_initial);
        }
    }
}
