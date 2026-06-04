using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Calendar.v3;
using Google.Apis.Services;
using Microsoft.Extensions.Logging;

namespace Api.Services;

public sealed class GoogleCalendarClient : IGoogleCalendarClient
{
    private readonly ILogger<GoogleCalendarClient> _logger;
    private readonly string _clientId;
    private readonly string _clientSecret;

    // Cached for the Lambda process lifetime (survives SnapStart warm invocations).
    // No TTL by design. When Google rejects the token with invalid_grant, ExecuteWithRetryAsync
    // force-reloads it from SSM once and retries, so updating the SSM parameter heals a running
    // instance on its next call without a redeploy. See docs/guides/google-calendar-token.md.
    // NOTE: if the SSM parameter uses a customer-managed KMS key (CMK), the Lambda execution role
    // must also have kms:Decrypt on that key in addition to ssm:GetParameter.
    private static string? _refreshToken;
    private static readonly SemaphoreSlim _initLock = new(1, 1);

    public GoogleCalendarClient(ILogger<GoogleCalendarClient> logger)
    {
        _logger = logger;
        _clientId = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID") ?? "";
        _clientSecret = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_SECRET") ?? "";
    }

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
    // force-reloads the token from SSM once and retries. This lets an operator heal a running
    // Lambda by updating the SSM parameter (re-mint) without a redeploy. Any other failure, or a
    // second invalid_grant, reports calendar_unavailable (returns null).
    private async Task<T?> ExecuteWithRetryAsync<T>(string operation, Func<CalendarService, Task<T?>> action)
        where T : class
    {
        var refreshToken = await GetRefreshTokenAsync();
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
                        "Google rejected the calendar refresh token (invalid_grant: {Description}) during {Operation}. The cached token is expired or revoked; reloading from SSM and retrying once.",
                        ex.Error?.ErrorDescription, operation);

                    var reloaded = await GetRefreshTokenAsync(forceReload: true);
                    if (reloaded is not null && reloaded != refreshToken)
                    {
                        refreshToken = reloaded;
                        continue;
                    }

                    _logger.LogError(
                        "Calendar refresh token in SSM is unchanged and still invalid (invalid_grant); reporting calendar_unavailable. Re-mint the token — see docs/guides/google-calendar-token.md.");
                    return null;
                }

                _logger.LogError(ex,
                    "Calendar refresh token still invalid (invalid_grant) after reloading from SSM during {Operation}; reporting calendar_unavailable. Re-mint the token — see docs/guides/google-calendar-token.md.",
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

    private async Task<string?> GetRefreshTokenAsync(bool forceReload = false)
    {
        if (!forceReload && _refreshToken is not null)
            return _refreshToken;

        await _initLock.WaitAsync();
        try
        {
            if (!forceReload && _refreshToken is not null)
                return _refreshToken;

            var ssmPath = Environment.GetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH");
            if (string.IsNullOrEmpty(ssmPath))
            {
                _logger.LogWarning(
                    "GOOGLE_REFRESH_TOKEN_SSM_PATH is not set; Google Calendar integration is disabled and will report calendar_unavailable");
                return null;
            }

            _logger.LogInformation("Loading Google refresh token from SSM path {Path}", ssmPath);

            using var ssm = new AmazonSimpleSystemsManagementClient();
            var response = await ssm.GetParameterAsync(new GetParameterRequest
            {
                Name = ssmPath,
                WithDecryption = true
            });
            _refreshToken = response.Parameter.Value;
            return _refreshToken;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load Google refresh token from SSM path {Path}",
                Environment.GetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH"));
            return null;
        }
        finally
        {
            _initLock.Release();
        }
    }
}
