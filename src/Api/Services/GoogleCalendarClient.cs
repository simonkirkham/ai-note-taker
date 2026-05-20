using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Calendar.v3;
using Google.Apis.Calendar.v3.Data;
using Google.Apis.Services;
using Microsoft.Extensions.Logging;

namespace Api.Services;

public sealed class GoogleCalendarClient : IGoogleCalendarClient
{
    private readonly ILogger<GoogleCalendarClient> _logger;
    private readonly string _clientId;
    private readonly string _clientSecret;

    // Cached for the Lambda process lifetime (survives SnapStart warm invocations).
    // Deliberately has no TTL: token revocation requires a Lambda redeployment or instance recycle.
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

    public async Task<IReadOnlyList<CalendarEvent>?> GetTodaysEventsAsync(string ianaTimezone)
    {
        try
        {
            var refreshToken = await GetRefreshTokenAsync();
            if (refreshToken is null)
                return null;

            using var flow = new GoogleAuthorizationCodeFlow(new GoogleAuthorizationCodeFlow.Initializer
            {
                ClientSecrets = new ClientSecrets { ClientId = _clientId, ClientSecret = _clientSecret },
                Scopes = new[] { CalendarService.Scope.CalendarReadonly }
            });

            var credential = new UserCredential(flow, "user", new TokenResponse
            {
                RefreshToken = refreshToken
            });

            using var service = new CalendarService(new BaseClientService.Initializer
            {
                HttpClientInitializer = credential,
                ApplicationName = "ai-note-taker"
            });

            var tz = TimeZoneInfo.FindSystemTimeZoneById(ianaTimezone);
            var nowUtc = DateTimeOffset.UtcNow;
            var todayLocal = TimeZoneInfo.ConvertTime(nowUtc, tz).Date; // DateTime (midnight local)
            var startOfDay = new DateTimeOffset(todayLocal, tz.GetUtcOffset(todayLocal));
            var endOfDay = startOfDay.AddDays(1);

            var request = service.Events.List("primary");
            request.TimeMinDateTimeOffset = startOfDay;
            request.TimeMaxDateTimeOffset = endOfDay;
            request.SingleEvents = true;

            var events = await request.ExecuteAsync();
            var utcOffset = tz.GetUtcOffset(todayLocal);

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
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Google Calendar API call failed");
            return null;
        }
    }

    public async Task<CalendarEvent?> GetNextOccurrenceAsync(string recurringSeriesId, DateTimeOffset after)
    {
        try
        {
            var refreshToken = await GetRefreshTokenAsync();
            if (refreshToken is null)
                return null;

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

            var request = service.Events.Instances("primary", recurringSeriesId);
            request.TimeMinDateTimeOffset = after;
            request.MaxResults = 1;

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
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetNextOccurrenceAsync failed for series {SeriesId}", recurringSeriesId);
            return null;
        }
    }

    private async Task<string?> GetRefreshTokenAsync()
    {
        if (_refreshToken is not null)
            return _refreshToken;

        await _initLock.WaitAsync();
        try
        {
            if (_refreshToken is not null)
                return _refreshToken;

            var ssmPath = Environment.GetEnvironmentVariable("GOOGLE_REFRESH_TOKEN_SSM_PATH");
            if (string.IsNullOrEmpty(ssmPath))
                return null;

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
