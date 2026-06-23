using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Microsoft Graph-backed calendar client (Phase 32-A). Reads the owner's M365 /
// Outlook calendar via /me/calendarView, which expands recurring series into
// instances server-side (the Graph equivalent of Google's SingleEvents=true).
//
// Auth mirrors GoogleCalendarClient: a refresh token (minted out-of-band, stored
// in SSM) is exchanged for a short-lived Graph access token per call. On Entra
// invalid_grant the token is reloaded from SSM once and retried, so re-minting
// heals a running Lambda without a redeploy. Public client => no client secret.
// See docs/guides/microsoft-calendar-token.md.
public sealed class MicrosoftCalendarClient : ICalendarClient
{
    private const string GraphScope = "https://graph.microsoft.com/Calendars.Read offline_access";
    private const string PreferUtc = "outlook.timezone=\"UTC\"";

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
        _tenantId = Environment.GetEnvironmentVariable("MS_TENANT_ID") is { Length: > 0 } t ? t : "common";
    }

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

            return ParseCalendarView(body);
        }
    }

    // Not implemented until Phase 32-B (recurring next-occurrence via Graph series
    // instances). Returns null (logged) so the existing endpoint degrades to "no next
    // occurrence" rather than 500-ing.
    public Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after)
    {
        _logger.LogInformation(
            "GetNextOccurrence for Microsoft series {SeriesId} is not implemented until Phase 32-B; returning null",
            recurringSeriesId);
        return Task.FromResult<CalendarEvent?>(null);
    }

    private IReadOnlyList<CalendarEvent> ParseCalendarView(string body)
    {
        using var doc = JsonDocument.Parse(body);
        var events = new List<CalendarEvent>();
        if (!doc.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array)
            return events;

        foreach (var item in value.EnumerateArray())
        {
            if (item.TryGetProperty("isCancelled", out var cancelled) &&
                cancelled.ValueKind == JsonValueKind.True)
                continue;

            var id = item.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            if (string.IsNullOrEmpty(id))
                continue;

            var title = item.TryGetProperty("subject", out var subj) && subj.ValueKind == JsonValueKind.String
                ? subj.GetString()!
                : "(No title)";

            var start = ParseGraphDateTime(item, "start");
            var end = ParseGraphDateTime(item, "end");
            if (start is null || end is null)
                continue;

            var seriesId = item.TryGetProperty("seriesMasterId", out var series) &&
                           series.ValueKind == JsonValueKind.String
                ? series.GetString()
                : null;
            var isRecurring = !string.IsNullOrEmpty(seriesId);

            events.Add(new CalendarEvent(
                CalendarEventId: id,
                Title: title,
                StartTime: start.Value,
                EndTime: end.Value,
                IsRecurring: isRecurring,
                RecurringSeriesId: isRecurring ? seriesId : null));
        }

        return events;
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
        var refreshToken = await _tokenSource.LoadAsync(forceReload: false);
        if (refreshToken is null)
            return null;

        if (string.IsNullOrEmpty(_clientId))
        {
            _logger.LogWarning("MS_CLIENT_ID is empty; reporting calendar_unavailable");
            return null;
        }

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
                    "Entra rejected the calendar refresh token (invalid_grant) during {Operation}. Reloading from SSM and retrying once.",
                    operation);
                var reloaded = await _tokenSource.LoadAsync(forceReload: true);
                if (reloaded is not null && reloaded != refreshToken)
                {
                    refreshToken = reloaded;
                    continue;
                }

                _logger.LogError(
                    "Microsoft refresh token in SSM is unchanged and still invalid (invalid_grant); reporting calendar_unavailable. Re-mint the token — see docs/guides/microsoft-calendar-token.md.");
                return null;
            }

            _logger.LogError(
                "Microsoft refresh token still invalid (invalid_grant) after reloading from SSM during {Operation}; reporting calendar_unavailable.",
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
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

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
