using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Calendar.v3;
using Google.Apis.Services;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Phase 34-A: the refresh token now comes from IGoogleCalendarTokenSource (per-user in-app
// connection, store-first; SSM fallback during coexistence). On invalid_grant we force-reload
// from the source once and retry — which heals the SSM fallback after a re-mint, and (for a
// genuinely dead per-user stored token) returns it unchanged so we give up and the UI offers
// "Reconnect". Scoped, because the token is now per-request/per-user.
public sealed class GoogleCalendarClient : ICalendarClient
{
    private readonly ILogger<GoogleCalendarClient> _logger;
    private readonly IGoogleCalendarTokenSource _tokenSource;
    private readonly string _clientId;
    private readonly string _clientSecret;

    public GoogleCalendarClient(ILogger<GoogleCalendarClient> logger, IGoogleCalendarTokenSource tokenSource)
    {
        _logger = logger;
        _tokenSource = tokenSource;
        _clientId = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID") ?? "";
        _clientSecret = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_SECRET") ?? "";
    }

    public string ProviderName => "google";

    public Task<IReadOnlyList<CalendarEvent>?> GetEventsForDayAsync(DateOnly date, string ianaTimezone) =>
        ExecuteWithRetryAsync<IReadOnlyList<CalendarEvent>>($"GetEventsForDay {date:yyyy-MM-dd}", async service =>
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(ianaTimezone);
            var dayLocal = date.ToDateTime(TimeOnly.MinValue); // DateTime (midnight local on the requested day)
            var utcOffset = tz.GetUtcOffset(dayLocal);
            var startOfDay = new DateTimeOffset(dayLocal, utcOffset);
            var endOfDay = startOfDay.AddDays(1);

            // Log the resolved local-day window so an off-by-one-day boundary bug is diagnosable.
            _logger.LogInformation(
                "Fetching calendar events for {Date} in {Timezone}: window {Start:o}–{End:o}",
                date, ianaTimezone, startOfDay, endOfDay);

            var request = service.Events.List("primary");
            request.TimeMinDateTimeOffset = startOfDay;
            request.TimeMaxDateTimeOffset = endOfDay;
            request.SingleEvents = true;

            var events = await request.ExecuteAsync();

            return (events.Items ?? [])
                .Where(e => e.Status != "cancelled")
                .Select(e =>
                {
                    // All-day events have Date only (no DateTimeDateTimeOffset); parse them with the
                    // caller's UTC offset so midnight is midnight in their timezone, not UTC.
                    var start = e.Start.DateTimeDateTimeOffset
                        ?? new DateTimeOffset(DateTime.Parse(e.Start.Date!), utcOffset);
                    var end = e.End.DateTimeDateTimeOffset
                        ?? new DateTimeOffset(DateTime.Parse(e.End.Date!), utcOffset);
                    var isRecurring = !string.IsNullOrEmpty(e.RecurringEventId);
                    return new CalendarEvent(
                        CalendarEventId: e.Id,
                        Title: e.Summary ?? "(No title)",
                        StartTime: start,
                        EndTime: end,
                        IsRecurring: isRecurring,
                        RecurringSeriesId: isRecurring ? e.RecurringEventId : null
                    );
                })
                .ToList();
        });

    public Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after) =>
        ExecuteWithRetryAsync<CalendarEvent>($"GetNextOccurrence for series {recurringSeriesId}", async service =>
        {
            var request = service.Events.Instances("primary", recurringSeriesId);
            request.TimeMinDateTimeOffset = after;
            request.MaxResults = 5;
            request.ShowDeleted = false;

            var result = await request.ExecuteAsync();
            var next = result.Items?.FirstOrDefault(e => e.Status != "cancelled");
            if (next is null) return null;

            var start = next.Start.DateTimeDateTimeOffset
                ?? new DateTimeOffset(DateTime.Parse(next.Start.Date!), TimeSpan.Zero);
            var end = next.End.DateTimeDateTimeOffset
                ?? new DateTimeOffset(DateTime.Parse(next.End.Date!), TimeSpan.Zero);

            return new CalendarEvent(
                CalendarEventId: next.Id,
                Title: next.Summary ?? "(No title)",
                StartTime: start,
                EndTime: end,
                IsRecurring: true,
                RecurringSeriesId: recurringSeriesId
            );
        });

    // Runs a Calendar API call, and if Google rejects the refresh token with invalid_grant,
    // force-reloads the token from the source once and retries. For the SSM fallback this heals a
    // re-mint without a redeploy; for a per-user in-app token it returns unchanged, so we give up
    // and report calendar_unavailable (the UI offers "Reconnect"). Any other failure also returns
    // null.
    private async Task<T?> ExecuteWithRetryAsync<T>(string operation, Func<CalendarService, Task<T?>> action)
        where T : class
    {
        var refreshToken = await _tokenSource.LoadAsync(forceReload: false);
        if (refreshToken is null)
            return null;

        if (string.IsNullOrEmpty(_clientId) || string.IsNullOrEmpty(_clientSecret))
        {
            _logger.LogWarning(
                "Google OAuth client is not configured (GOOGLE_CLIENT_ID empty: {ClientIdEmpty}, GOOGLE_CLIENT_SECRET empty: {ClientSecretEmpty}); reporting calendar_unavailable",
                string.IsNullOrEmpty(_clientId), string.IsNullOrEmpty(_clientSecret));
            return null;
        }

        for (var attempt = 1; attempt <= 2; attempt++)
        {
            using var flow = new GoogleAuthorizationCodeFlow(new GoogleAuthorizationCodeFlow.Initializer
            {
                ClientSecrets = new ClientSecrets { ClientId = _clientId, ClientSecret = _clientSecret },
                Scopes = new[] { CalendarService.Scope.CalendarReadonly }
            });

            var credential = new UserCredential(flow, "user", new TokenResponse { RefreshToken = refreshToken });

            using var service = new CalendarService(new BaseClientService.Initializer
            {
                HttpClientInitializer = credential,
                ApplicationName = "ai-note-taker"
            });

            try
            {
                return await action(service);
            }
            catch (TokenResponseException ex) when (ex.Error?.Error == "invalid_grant")
            {
                if (attempt == 1)
                {
                    _logger.LogWarning(ex,
                        "Google rejected the calendar refresh token (invalid_grant: {Description}) during {Operation}. Reloading from the token source and retrying once.",
                        ex.Error?.ErrorDescription, operation);

                    var reloaded = await _tokenSource.LoadAsync(forceReload: true);
                    if (reloaded is not null && reloaded != refreshToken)
                    {
                        refreshToken = reloaded;
                        continue;
                    }

                    _logger.LogError(
                        "Calendar refresh token unchanged and still invalid (invalid_grant); reporting calendar_unavailable. Reconnect the calendar (or re-mint the SSM token).");
                    return null;
                }

                _logger.LogError(ex,
                    "Calendar refresh token still invalid (invalid_grant) after reload during {Operation}; reporting calendar_unavailable.",
                    operation);
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Google Calendar API call failed during {Operation}", operation);
                return null;
            }
        }

        return null;
    }
}
