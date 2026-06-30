using Api.Auth;
using Ical.Net;
using Ical.Net.CalendarComponents;
using Ical.Net.DataTypes;
using Ical.Net.Evaluation;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// 34-E: a calendar provider backed by a published ICS feed URL (e.g. Outlook "Publish a calendar"),
// bypassing the Microsoft admin-consent wall. The feed URL is stored as the "ics" token's
// RefreshToken (Email is null — a feed carries no account identity). Each read fetches the URL and
// expands recurrences locally with Ical.Net.
//
// Graceful degradation mirrors the other clients: ANY fetch/parse/HTTP error returns null
// (→ calendar_unavailable), never throws — the GET meetings handler maps null but has NO catch
// (the 34-D1 lesson). Scoped (reads ICalendarScope — 42-A).
//
// v1 fetches the feed per request with the typed HttpClient's 10s timeout and no caching. A busy
// day view re-downloads the feed each navigation; per-request caching (keyed by URL+date with a
// short TTL) is a possible follow-up.
public sealed class IcsFeedCalendarClient : ICalendarClient
{
    private const string Provider = "ics";

    // Bounded lookahead for the next occurrence of a recurring series — matches the Microsoft
    // client's 400-day window (covers weekly/monthly/annual series).
    private const int NextOccurrenceLookaheadDays = 400;

    private readonly ILogger<IcsFeedCalendarClient> _logger;
    private readonly HttpClient _http;
    private readonly ICalendarScope _scope;
    private readonly ICalendarTokenStore _store;

    public IcsFeedCalendarClient(
        ILogger<IcsFeedCalendarClient> logger,
        HttpClient http,
        ICalendarScope scope,
        ICalendarTokenStore store)
    {
        _logger = logger;
        _http = http;
        _scope = scope;
        _store = store;
    }

    public string ProviderName => Provider;

    public async Task<IReadOnlyList<CalendarEvent>?> GetEventsForDayAsync(DateOnly date, string ianaTimezone)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(ianaTimezone);
        var dayLocal = date.ToDateTime(TimeOnly.MinValue);
        var utcOffset = tz.GetUtcOffset(dayLocal);
        var startOfDay = new DateTimeOffset(dayLocal, utcOffset);
        var endOfDay = startOfDay.AddDays(1);

        // Log the resolved local-day window so an off-by-one-day boundary bug is diagnosable.
        _logger.LogInformation(
            "Fetching ICS calendar events for {Date} in {Timezone}: window {Start:o}–{End:o}",
            date, ianaTimezone, startOfDay, endOfDay);

        var calendar = await FetchAndParseAsync($"GetEventsForDay {date:yyyy-MM-dd}");
        if (calendar is null)
            return null;

        var windowStart = new CalDateTime(startOfDay.UtcDateTime, hasTime: true);
        var events = new List<CalendarEvent>();
        foreach (var occurrence in calendar.GetOccurrences(windowStart, new EvaluationOptions()))
        {
            var start = occurrence.Period.StartTime?.AsUtc;
            if (start is null)
                continue;
            // GetOccurrences yields ascending by start, so the first occurrence at/after the day's
            // end means we are past the window — stop enumerating the (otherwise unbounded) series.
            if (start.Value >= endOfDay.UtcDateTime)
                break;

            var mapped = MapOccurrence(occurrence);
            if (mapped is not null)
                events.Add(mapped);
        }

        return events;
    }

    // Next future instance of a recurring series identified by its VEVENT UID. Expands occurrences
    // over [after, after+400d] and returns the first non-cancelled, RecurringSeriesId forced to the
    // UID. null when none fall in the lookahead → the handler maps it to no_future_occurrences (404).
    public async Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after)
    {
        var windowStart = after.ToUniversalTime();
        var windowEnd = windowStart.AddDays(NextOccurrenceLookaheadDays);

        _logger.LogInformation(
            "Fetching next ICS occurrence for series {SeriesId}: window {Start:o}–{End:o}",
            recurringSeriesId, windowStart, windowEnd);

        var calendar = await FetchAndParseAsync($"GetNextOccurrence series {recurringSeriesId}");
        if (calendar is null)
            return null;

        var start = new CalDateTime(windowStart.UtcDateTime, hasTime: true);
        foreach (var occurrence in calendar.GetOccurrences(start, new EvaluationOptions()))
        {
            var occStart = occurrence.Period.StartTime?.AsUtc;
            if (occStart is null)
                continue;
            if (occStart.Value >= windowEnd.UtcDateTime)
                break;
            if (occurrence.Source is not Ical.Net.CalendarComponents.CalendarEvent ev || ev.Uid != recurringSeriesId)
                continue;
            if (IsCancelled(ev))
                continue;

            var end = occurrence.Period.EffectiveEndTime?.AsUtc ?? occStart.Value;
            // Force the series link to the known UID so the created note links the series, not just
            // the instance.
            return new CalendarEvent(
                CalendarEventId: StableEventId(recurringSeriesId, occStart.Value),
                Title: TitleOf(ev),
                StartTime: new DateTimeOffset(occStart.Value, TimeSpan.Zero),
                EndTime: new DateTimeOffset(end, TimeSpan.Zero),
                IsRecurring: true,
                RecurringSeriesId: recurringSeriesId);
        }

        return null;
    }

    // Fetches the stored feed URL and parses it into a Calendar, or null on any failure. Re-runs the
    // SSRF guard before each fetch (best-effort — a stored URL could predate a guard tightening; note
    // the documented rebinding TOCTOU residual in IcsUrlValidator). The typed HttpClient is configured
    // with AllowAutoRedirect=false + a body-size cap, so a 3xx-to-internal can't bypass the guard and a
    // giant feed can't OOM the Lambda.
    private async Task<Calendar?> FetchAndParseAsync(string operation)
    {
        CalendarToken? token;
        try
        {
            token = await _store.GetAsync(_scope.UserId, _scope.WorkspaceId, Provider);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ICS calendar token store read failed during {Operation}; reporting calendar_unavailable", operation);
            return null;
        }

        var url = token?.RefreshToken;
        if (string.IsNullOrEmpty(url))
        {
            _logger.LogInformation("No ICS feed configured for workspace {WorkspaceId}; reporting calendar_unavailable", _scope.WorkspaceId);
            return null;
        }

        if (!IcsUrlValidator.IsAllowed(url))
        {
            _logger.LogWarning("Stored ICS feed URL failed the SSRF guard during {Operation} (workspace {WorkspaceId}); reporting calendar_unavailable", operation, _scope.WorkspaceId);
            return null;
        }

        string body;
        try
        {
            using var response = await _http.GetAsync(url);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("ICS feed fetch returned {Status} during {Operation}; reporting calendar_unavailable", (int)response.StatusCode, operation);
                return null;
            }
            body = await response.Content.ReadAsStringAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ICS feed fetch failed (transport/timeout) during {Operation}; reporting calendar_unavailable", operation);
            return null;
        }

        try
        {
            return Calendar.Load(body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ICS feed body failed to parse during {Operation}; reporting calendar_unavailable", operation);
            return null;
        }
    }

    // Maps one expanded occurrence to a CalendarEvent, or null if its source is cancelled. A source
    // VEVENT with a recurrence rule (or that is itself a recurring instance) is flagged IsRecurring
    // with RecurringSeriesId = the VEVENT UID, mirroring the Microsoft seriesMasterId link.
    private static CalendarEvent? MapOccurrence(Occurrence occurrence)
    {
        if (occurrence.Source is not Ical.Net.CalendarComponents.CalendarEvent ev)
            return null;
        if (IsCancelled(ev))
            return null;

        var start = occurrence.Period.StartTime?.AsUtc;
        if (start is null)
            return null;
        var end = occurrence.Period.EffectiveEndTime?.AsUtc ?? start.Value;

        var isRecurring = ev.RecurrenceRule is not null || ev.RecurrenceDates.GetAllDates().Any();
        var uid = ev.Uid ?? "";

        return new CalendarEvent(
            CalendarEventId: StableEventId(uid, start.Value),
            Title: TitleOf(ev),
            StartTime: new DateTimeOffset(start.Value, TimeSpan.Zero),
            EndTime: new DateTimeOffset(end, TimeSpan.Zero),
            IsRecurring: isRecurring,
            RecurringSeriesId: isRecurring ? uid : null);
    }

    private static bool IsCancelled(Ical.Net.CalendarComponents.CalendarEvent ev) =>
        string.Equals(ev.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase);

    private static string TitleOf(Ical.Net.CalendarComponents.CalendarEvent ev) =>
        string.IsNullOrWhiteSpace(ev.Summary) ? "(No title)" : ev.Summary;

    // A single VEVENT UID is shared by every occurrence of a recurring series, so the per-instance id
    // must fold in the occurrence start to stay unique (round-tripping "create note for THIS
    // occurrence"). Deterministic so the same instance maps to the same id across requests.
    private static string StableEventId(string uid, DateTime startUtc) =>
        $"{uid}::{startUtc:yyyyMMddTHHmmssZ}";
}
