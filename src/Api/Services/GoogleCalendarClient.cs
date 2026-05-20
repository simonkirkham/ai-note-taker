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

    // Cached across SnapStart warm invocations; loaded once on cold start.
    private static string? _refreshToken;
    private static readonly SemaphoreSlim _initLock = new(1, 1);

    public GoogleCalendarClient(ILogger<GoogleCalendarClient> logger)
    {
        _logger = logger;
    }

    public async Task<IReadOnlyList<CalendarEvent>?> GetTodaysEventsAsync(string ianaTimezone)
    {
        try
        {
            var refreshToken = await GetRefreshTokenAsync();
            if (refreshToken is null)
                return null;

            var clientId = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID") ?? "";
            var clientSecret = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_SECRET") ?? "";

            var flow = new GoogleAuthorizationCodeFlow(new GoogleAuthorizationCodeFlow.Initializer
            {
                ClientSecrets = new ClientSecrets { ClientId = clientId, ClientSecret = clientSecret },
                Scopes = new[] { CalendarService.Scope.CalendarReadonly }
            });

            var credential = new UserCredential(flow, "user", new TokenResponse
            {
                RefreshToken = refreshToken
            });

            var service = new CalendarService(new BaseClientService.Initializer
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
            request.OrderBy = EventsResource.ListRequest.OrderByEnum.StartTime;

            var events = await request.ExecuteAsync();

            return events.Items
                .Where(e => e.Status != "cancelled")
                .Select(e =>
                {
                    var start = e.Start.DateTimeDateTimeOffset ?? DateTimeOffset.Parse(e.Start.Date!);
                    var end = e.End.DateTimeDateTimeOffset ?? DateTimeOffset.Parse(e.End.Date!);
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

    private static async Task<string?> GetRefreshTokenAsync()
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
        catch
        {
            return null;
        }
        finally
        {
            _initLock.Release();
        }
    }
}
