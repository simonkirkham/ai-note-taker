using System.Net;
using System.Text;
using Api.Auth;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// Unit tests for the ICS feed calendar client (34-E). Drives a mocked HttpClient returning canned
// ICS bodies and an in-memory token store carrying the feed URL, asserting Ical.Net occurrence
// expansion, the local-day window, cancelled-event skipping, next-occurrence-by-UID, and graceful
// degradation to null on any fetch/parse error.
public sealed class IcsFeedCalendarClientTests
{
    private const string User = "test-user";
    private const string Ws = "ws-1";
    // A public literal IP (resolves to itself → passes the SSRF guard offline). The mock HttpClient
    // intercepts the request regardless of host, so the address is never actually contacted.
    private const string FeedUrl = "https://8.8.8.8/cal.ics";

    private sealed class StubCalendarScope : ICalendarScope
    {
        public string UserId => User;
        public string WorkspaceId => Ws;
    }

    private static IcsFeedCalendarClient Build(StubHandler handler, bool seedToken = true, string? url = FeedUrl)
    {
        var store = new InMemoryCalendarTokenStore();
        if (seedToken)
            store.Seed(User, Ws, "ics", url!);
        var http = new HttpClient(handler);
        return new IcsFeedCalendarClient(
            NullLogger<IcsFeedCalendarClient>.Instance, http, new StubCalendarScope(), store);
    }

    private static string Ics(string vevents) =>
        $"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n{vevents}\r\nEND:VCALENDAR";

    private static StubHandler Returns(string body) =>
        new(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "text/calendar") });

    [Fact]
    public async Task GetEventsForDay_MapsSingleTimedEventOnTheDay()
    {
        var ics = Ics("""
            BEGIN:VEVENT
            UID:single-1
            DTSTART:20260622T083000Z
            DTEND:20260622T090000Z
            SUMMARY:Test Meeting
            END:VEVENT
            """);
        var client = Build(Returns(ics));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.NotNull(result);
        Assert.Single(result!);
        Assert.Equal("Test Meeting", result![0].Title);
        Assert.Equal(new DateTimeOffset(2026, 6, 22, 8, 30, 0, TimeSpan.Zero), result[0].StartTime);
        Assert.Equal(new DateTimeOffset(2026, 6, 22, 9, 0, 0, TimeSpan.Zero), result[0].EndTime);
        Assert.False(result[0].IsRecurring);
        Assert.Null(result[0].RecurringSeriesId);
        // CalendarEventId folds in the occurrence start so recurring instances stay unique.
        Assert.Contains("single-1", result[0].CalendarEventId);
    }

    [Fact]
    public async Task GetEventsForDay_ExpandsWeeklyRecurrenceIntoTheWindow()
    {
        // Series starts 2026-06-01; the 2026-06-22 occurrence must appear (and only it).
        var ics = Ics("""
            BEGIN:VEVENT
            UID:weekly-1
            DTSTART:20260601T090000Z
            DTEND:20260601T093000Z
            RRULE:FREQ=WEEKLY
            SUMMARY:Weekly Sync
            END:VEVENT
            """);
        var client = Build(Returns(ics));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.NotNull(result);
        Assert.Single(result!);
        Assert.Equal("Weekly Sync", result![0].Title);
        Assert.Equal(new DateTimeOffset(2026, 6, 22, 9, 0, 0, TimeSpan.Zero), result[0].StartTime);
        Assert.True(result[0].IsRecurring);
        Assert.Equal("weekly-1", result[0].RecurringSeriesId);
    }

    [Fact]
    public async Task GetEventsForDay_SkipsCancelledEvents()
    {
        var ics = Ics("""
            BEGIN:VEVENT
            UID:live
            DTSTART:20260622T080000Z
            DTEND:20260622T083000Z
            SUMMARY:Live
            END:VEVENT
            BEGIN:VEVENT
            UID:gone
            DTSTART:20260622T090000Z
            DTEND:20260622T093000Z
            STATUS:CANCELLED
            SUMMARY:Cancelled
            END:VEVENT
            """);
        var client = Build(Returns(ics));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.NotNull(result);
        Assert.Single(result!);
        Assert.Equal("Live", result![0].Title);
    }

    [Fact]
    public async Task GetEventsForDay_EventWithNoSummary_TitledNoTitle()
    {
        var ics = Ics("""
            BEGIN:VEVENT
            UID:untitled
            DTSTART:20260622T080000Z
            DTEND:20260622T083000Z
            END:VEVENT
            """);
        var client = Build(Returns(ics));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.NotNull(result);
        Assert.Equal("(No title)", result![0].Title);
    }

    [Fact]
    public async Task GetEventsForDay_ExcludesEventsOutsideTheLocalDayWindow()
    {
        // 22:00 in America/New_York on 2026-06-22 is 02:00 UTC on 2026-06-23 — must still be in the
        // requested local day; an event the next local morning must not.
        var ics = Ics("""
            BEGIN:VEVENT
            UID:late
            DTSTART:20260623T020000Z
            DTEND:20260623T030000Z
            SUMMARY:Late NY meeting
            END:VEVENT
            BEGIN:VEVENT
            UID:nextday
            DTSTART:20260623T130000Z
            DTEND:20260623T140000Z
            SUMMARY:Next day
            END:VEVENT
            """);
        var client = Build(Returns(ics));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "America/New_York");

        Assert.NotNull(result);
        Assert.Single(result!);
        Assert.Equal("Late NY meeting", result![0].Title);
    }

    [Fact]
    public async Task GetEventsForDay_MalformedBody_ReturnsNullWithoutThrowing()
    {
        var client = Build(Returns("this is not an ics file at all"));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetEventsForDay_HttpError_ReturnsNull()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        var client = Build(handler);

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetEventsForDay_RedirectResponse_ReturnsNull_NotFollowed()
    {
        // SSRF defense: the real HttpClient is configured AllowAutoRedirect=false, so a feed that
        // 302s to an internal/metadata address surfaces here AS a 3xx (not the followed target). The
        // client must treat a non-2xx as calendar_unavailable. (The DI client never follows; this
        // proves the status handling.)
        var redirect = new HttpResponseMessage(HttpStatusCode.Redirect);
        redirect.Headers.Location = new Uri("http://169.254.169.254/latest/meta-data/");
        var client = Build(new StubHandler(_ => redirect));

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetEventsForDay_TransportException_ReturnsNull()
    {
        var handler = new StubHandler(_ => throw new HttpRequestException("boom"));
        var client = Build(handler);

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetEventsForDay_NoStoredFeed_ReturnsNullWithoutFetching()
    {
        var handler = new StubHandler(_ => throw new InvalidOperationException("should not fetch without a feed url"));
        var client = Build(handler, seedToken: false);

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetEventsForDay_StoredFeedFailsSsrfGuard_ReturnsNullWithoutFetching()
    {
        // A stored URL that resolves to loopback (DNS-rebinding defense in depth) must be refused
        // before any fetch.
        var handler = new StubHandler(_ => throw new InvalidOperationException("should not fetch a private url"));
        var client = Build(handler, url: "https://localhost/cal.ics");

        var result = await client.GetEventsForDayAsync(new DateOnly(2026, 6, 22), "UTC");

        Assert.Null(result);
    }

    [Fact]
    public async Task GetNextOccurrence_ReturnsFirstFutureNonCancelledInstanceByUid()
    {
        var ics = Ics("""
            BEGIN:VEVENT
            UID:standup
            DTSTART:20260601T090000Z
            DTEND:20260601T091500Z
            RRULE:FREQ=WEEKLY
            SUMMARY:Standup
            END:VEVENT
            """);
        var client = Build(Returns(ics));

        // after 2026-06-23 → next weekly occurrence is 2026-06-29.
        var result = await client.GetNextOccurrenceAsync("standup", new DateTimeOffset(2026, 6, 23, 0, 0, 0, TimeSpan.Zero));

        Assert.NotNull(result);
        Assert.Equal("Standup", result!.Title);
        Assert.Equal(new DateTimeOffset(2026, 6, 29, 9, 0, 0, TimeSpan.Zero), result.StartTime);
        Assert.True(result.IsRecurring);
        Assert.Equal("standup", result.RecurringSeriesId);
    }

    [Fact]
    public async Task GetNextOccurrence_UnknownUid_ReturnsNull()
    {
        var ics = Ics("""
            BEGIN:VEVENT
            UID:standup
            DTSTART:20260601T090000Z
            DTEND:20260601T091500Z
            RRULE:FREQ=WEEKLY
            SUMMARY:Standup
            END:VEVENT
            """);
        var client = Build(Returns(ics));

        var result = await client.GetNextOccurrenceAsync("does-not-exist", new DateTimeOffset(2026, 6, 23, 0, 0, 0, TimeSpan.Zero));

        Assert.Null(result);
    }

    [Fact]
    public async Task GetNextOccurrence_MalformedBody_ReturnsNull()
    {
        var client = Build(Returns("garbage"));

        var result = await client.GetNextOccurrenceAsync("standup", new DateTimeOffset(2026, 6, 23, 0, 0, 0, TimeSpan.Zero));

        Assert.Null(result);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _respond;
        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) => _respond = respond;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(_respond(request));
    }
}
