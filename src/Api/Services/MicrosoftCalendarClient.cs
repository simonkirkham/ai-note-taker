using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Microsoft Graph-backed calendar client (Phase 32-A). Reads the workspace's M365 /
// Outlook calendar via /me/calendarView, which expands recurring series into
// instances server-side (the Graph equivalent of Google's SingleEvents=true).
//
// Auth mirrors GoogleCalendarClient: the per-(user,workspace) in-app refresh token
// (IMicrosoftRefreshTokenSource → CalendarTokenStore since 34-D2) is exchanged for a
// short-lived Graph access token per call. On Entra invalid_grant the token source is
// re-read once and retried; for an in-app token that re-read returns the same value, so
// the client gives up and the UI offers "Reconnect" (CHANGE-25). Public client => no
// client secret.
public sealed class MicrosoftCalendarClient : ICalendarClient
{
    private const string GraphScope = "https://graph.microsoft.com/Calendars.Read offline_access";
    private const string PreferUtc = "outlook.timezone=\"UTC\"";

    // Bounded lookahead for the next occurrence of a recurring series. The Graph instances
    // endpoint requires an explicit end window; ~400 days covers weekly/monthly/annual series
    // while keeping the result set tiny.
    private const int NextOccurrenceLookaheadDays = 400;

    private readonly ILogger<MicrosoftCalendarClient> _logger;
    private readonly HttpClient _http;
    private readonly IMicrosoftRefreshTokenSource _tokenSource;
    private readonly string _clientId;
    private readonly string _tenantId;

    public MicrosoftCalendarClient(
        ILogger<MicrosoftCalendarClient> logger,
        HttpClient http,
        IMicrosoftRefreshTokenSource tokenSource)
    {
        _logger = logger;
        _http = http;
        _tokenSource = tokenSource;
        _clientId = Environment.GetEnvironmentVariable("MS_CLIENT_ID") ?? "";
        // CHANGE-26: default "common" (work/school + personal accounts) — the same default the in-app
        // connect uses (buildMicrosoftAuthUrl). A token granted against one tenant alias but refreshed
        // against another yields invalid_grant, so the consent tenant and this default MUST match. Set
        // MS_TENANT_ID explicitly to pin a single tenant.
        _tenantId = Environment.GetEnvironmentVariable("MS_TENANT_ID") is { Length: > 0 } t ? t : "common";
    }

    public string ProviderName => "microsoft";

    public async Task<IReadOnlyList<CalendarEvent>?> GetEventsForDayAsync(DateOnly date, string ianaTimezone)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(ianaTimezone);
        var dayLocal = date.ToDateTime(TimeOnly.MinValue);
        var utcOffset = tz.GetUtcOffset(dayLocal);
        var startOfDay = new DateTimeOffset(dayLocal, utcOffset);
        var endOfDay = startOfDay.AddDays(1);

        // Log the resolved local-day window so an off-by-one-day boundary bug is diagnosable.
        _logger.LogInformation(
            "Fetching Microsoft calendar events for {Date} in {Timezone}: window {Start:o}–{End:o}",
            date, ianaTimezone, startOfDay, endOfDay);

        var accessToken = await AcquireAccessTokenAsync($"GetEventsForDay {date:yyyy-MM-dd}");
        if (accessToken is null)
            return null;

        // $top=100 caps a single day's events; we do not follow @odata.nextLink. A day with >100
        // calendar entries would silently truncate — acceptable for a single-user day view.
        var url = "https://graph.microsoft.com/v1.0/me/calendarView"
            + $"?startDateTime={ToGraphUtc(startOfDay)}&endDateTime={ToGraphUtc(endOfDay)}"
            + "&$select=id,subject,start,end,isAllDay,isCancelled,seriesMasterId"
            + "&$orderby=start/dateTime&$top=100";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.TryAddWithoutValidation("Prefer", PreferUtc);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Microsoft Graph calendarView request failed (transport)");
            return null;
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                // Surface the Graph error (e.g. ErrorAccessDenied for a missing scope) rather than
                // collapsing to an empty list — an empty list reads as "no meetings", hiding the fault.
                _logger.LogError("Microsoft Graph calendarView returned {Status}: {Body}",
                    (int)response.StatusCode, body);
                return null;
            }

            try
            {
                return ParseCalendarView(body);
            }
            catch (JsonException ex)
            {
                // A malformed/non-JSON 200 body (e.g. an HTML response from an intermediary) must
                // degrade to calendar_unavailable, never bubble a 500 out of the GET handler.
                _logger.LogError(ex, "Failed to parse Microsoft Graph calendarView response body");
                return null;
            }
        }
    }

    // Returns the next future instance of a recurring series via the Graph instances endpoint
    // (/me/events/{seriesMasterId}/instances), which expands the series over a bounded window.
    // Skips cancelled instances and returns null when none fall in the lookahead — the handler
    // maps null to no_future_occurrences (404), never a 500.
    public async Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after)
    {
        var windowStart = after.ToUniversalTime();
        var windowEnd = windowStart.AddDays(NextOccurrenceLookaheadDays);

        _logger.LogInformation(
            "Fetching next Microsoft occurrence for series {SeriesId}: window {Start:o}–{End:o}",
            recurringSeriesId, windowStart, windowEnd);

        var accessToken = await AcquireAccessTokenAsync($"GetNextOccurrence series {recurringSeriesId}");
        if (accessToken is null)
            return null;

        var url = $"https://graph.microsoft.com/v1.0/me/events/{Uri.EscapeDataString(recurringSeriesId)}/instances"
            + $"?startDateTime={ToGraphUtc(windowStart)}&endDateTime={ToGraphUtc(windowEnd)}"
            + "&$select=id,subject,start,end,isAllDay,isCancelled,seriesMasterId"
            // $orderby ascending + take the first non-cancelled instance = the next occurrence.
            // $top=10 assumes fewer than 10 leading cancellations at the window start (implausible
            // for a next-occurrence query); we do not page beyond it.
            + "&$orderby=start/dateTime&$top=10";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.TryAddWithoutValidation("Prefer", PreferUtc);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Microsoft Graph series-instances request failed (transport)");
            return null;
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Microsoft Graph series-instances returned {Status}: {Body}",
                    (int)response.StatusCode, body);
                return null;
            }

            try
            {
                return ParseFirstInstance(body, recurringSeriesId);
            }
            catch (JsonException ex)
            {
                _logger.LogError(ex, "Failed to parse Microsoft Graph series-instances response body");
                return null;
            }
        }
    }

    private IReadOnlyList<CalendarEvent> ParseCalendarView(string body)
    {
        using var doc = JsonDocument.Parse(body);
        var events = new List<CalendarEvent>();
        if (!doc.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array)
            return events;

        foreach (var item in value.EnumerateArray())
        {
            var mapped = TryMapEvent(item);
            if (mapped is not null)
                events.Add(mapped);
        }

        return events;
    }

    // First non-cancelled instance of a series (the list is $orderby start/dateTime). The series
    // id is forced onto the result so the created note links back to the series, not just the
    // instance.
    private CalendarEvent? ParseFirstInstance(string body, string recurringSeriesId)
    {
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array)
            return null;

        foreach (var item in value.EnumerateArray())
        {
            var mapped = TryMapEvent(item, recurringSeriesId);
            if (mapped is not null)
                return mapped;
        }

        return null;
    }

    // Maps one Graph event/instance to a CalendarEvent, or null if cancelled or missing
    // id/start/end. recurringSeriesIdOverride forces the series link to the known master id
    // (used for instances) so the result is recurring even if an instance omits seriesMasterId;
    // when null the event's own seriesMasterId is used (day view).
    private static CalendarEvent? TryMapEvent(JsonElement item, string? recurringSeriesIdOverride = null)
    {
        if (item.TryGetProperty("isCancelled", out var cancelled) &&
            cancelled.ValueKind == JsonValueKind.True)
            return null;

        var id = item.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        if (string.IsNullOrEmpty(id))
            return null;

        var title = item.TryGetProperty("subject", out var subj) && subj.ValueKind == JsonValueKind.String
            ? subj.GetString()!
            : "(No title)";

        var start = ParseGraphDateTime(item, "start");
        var end = ParseGraphDateTime(item, "end");
        if (start is null || end is null)
            return null;

        var seriesId = recurringSeriesIdOverride
            ?? (item.TryGetProperty("seriesMasterId", out var series) && series.ValueKind == JsonValueKind.String
                ? series.GetString()
                : null);
        var isRecurring = !string.IsNullOrEmpty(seriesId);

        return new CalendarEvent(
            CalendarEventId: id,
            Title: title,
            StartTime: start.Value,
            EndTime: end.Value,
            IsRecurring: isRecurring,
            RecurringSeriesId: isRecurring ? seriesId : null);
    }

    // Graph returns { dateTime: "2026-06-22T08:30:00.0000000", timeZone: "UTC" }. We sent
    // Prefer: outlook.timezone="UTC", so dateTime is naive UTC — read it as UTC.
    private static DateTimeOffset? ParseGraphDateTime(JsonElement item, string property)
    {
        if (!item.TryGetProperty(property, out var slot) ||
            !slot.TryGetProperty("dateTime", out var dt) ||
            dt.ValueKind != JsonValueKind.String)
            return null;

        var raw = dt.GetString();
        if (string.IsNullOrEmpty(raw))
            return null;

        var utc = DateTime.Parse(raw, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
        return new DateTimeOffset(utc, TimeSpan.Zero);
    }

    private static string ToGraphUtc(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss'Z'", CultureInfo.InvariantCulture);

    // Exchanges the SSM refresh token for a Graph access token. On Entra invalid_grant,
    // reloads the token from SSM once and retries (heals re-minting without a redeploy).
    private async Task<string?> AcquireAccessTokenAsync(string operation)
    {
        // Check config before paying an SSM round-trip: a deploy with no client id can't mint a
        // token regardless of what SSM holds.
        if (string.IsNullOrEmpty(_clientId))
        {
            _logger.LogWarning("MS_CLIENT_ID is empty; reporting calendar_unavailable");
            return null;
        }

        var refreshToken = await _tokenSource.LoadAsync(forceReload: false);
        if (refreshToken is null)
            return null;

        for (var attempt = 1; attempt <= 2; attempt++)
        {
            var (accessToken, invalidGrant) = await PostTokenAsync(refreshToken);
            if (accessToken is not null)
                return accessToken;

            if (!invalidGrant)
                return null; // non-recoverable token error already logged

            if (attempt == 1)
            {
                _logger.LogWarning(
                    "Entra rejected the calendar refresh token (invalid_grant) during {Operation}. Re-reading the token source and retrying once.",
                    operation);
                var reloaded = await _tokenSource.LoadAsync(forceReload: true);
                if (reloaded is not null && reloaded != refreshToken)
                {
                    refreshToken = reloaded;
                    continue;
                }

                _logger.LogError(
                    "Microsoft in-app calendar token is unchanged and still invalid (invalid_grant); reporting calendar_unavailable. The user must reconnect Outlook (Calendar settings → Connect Outlook).");
                return null;
            }

            _logger.LogError(
                "Microsoft in-app calendar token still invalid (invalid_grant) after re-read during {Operation}; reporting calendar_unavailable.",
                operation);
            return null;
        }

        return null;
    }

    private async Task<(string? accessToken, bool invalidGrant)> PostTokenAsync(string refreshToken)
    {
        var tokenUrl = $"https://login.microsoftonline.com/{_tenantId}/oauth2/v2.0/token";
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = _clientId,
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
            ["scope"] = GraphScope
        });

        HttpResponseMessage response;
        try
        {
            response = await _http.PostAsync(tokenUrl, content);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Microsoft token endpoint request failed (transport)");
            return (null, false);
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync();
            JsonElement root;
            JsonDocument? doc = null;
            try
            {
                doc = JsonDocument.Parse(body);
                root = doc.RootElement;
            }
            catch (JsonException ex)
            {
                // A non-JSON error body (e.g. an HTML 5xx from a proxy) must not throw out of the
                // retry loop and become a 500 — report a non-recoverable token error gracefully.
                doc?.Dispose();
                _logger.LogError(ex, "Microsoft token endpoint returned a non-JSON body ({Status})",
                    (int)response.StatusCode);
                return (null, false);
            }

            using (doc)
            {
                if (response.IsSuccessStatusCode &&
                    root.TryGetProperty("access_token", out var at) &&
                    at.ValueKind == JsonValueKind.String)
                    return (at.GetString(), false);

                var error = root.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String
                    ? err.GetString()
                    : null;
                if (error == "invalid_grant")
                    return (null, true);

                _logger.LogError("Microsoft token endpoint returned {Status} error={Error}: {Body}",
                    (int)response.StatusCode, error, body);
                return (null, false);
            }
        }
    }
}
