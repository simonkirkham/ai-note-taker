using Api.Auth;
using Api.CommandHandlers;
using Api.Services;
using Domain.Workspaces;
using Ical.Net;

namespace Api.Endpoints;

// In-app "Connect calendar" — auth-code+PKCE exchanged server-side, the refresh token persisted in
// ICalendarTokenStore keyed by (user, workspace, provider) and a WorkspaceCalendarConnected event
// recorded on the workspace. 34-C adds Microsoft alongside Google and makes the connection
// provider-aware. **One provider per workspace** (locked decision #3): connecting one provider
// deletes the other's token. Mounted under `/w/{workspaceId}` so the browser's active workspace
// scopes the connect. All routes require auth: `userId` from the validated bearer, `workspaceId`
// from the validated route prefix — never request input.
public static class CalendarAuthEndpoints
{
    private const string Google = "google";
    private const string Microsoft = "microsoft";
    private const string Ics = "ics";
    private static readonly string[] AllProviders = [Google, Microsoft, Ics];

    public static void MapCalendarAuthEndpoints(this WebApplication app)
    {
        var scoped = app.MapGroup("/w/{workspaceId}").AddEndpointFilter<WorkspaceValidationFilter>();

        scoped.MapPost("/calendar/connect/google", async (
            CalendarConnectRequest req, IGoogleOAuthClient google, ICalendarTokenStore store,
            ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, IWorkspaceCommandHandler workspaceHandler,
            ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Api.Calendar.Connect");
            if (string.IsNullOrEmpty(req.Code) || string.IsNullOrEmpty(req.CodeVerifier) || string.IsNullOrEmpty(req.RedirectUri))
                return Results.BadRequest(new { error = "invalid_request" });

            GoogleTokenResult result;
            try
            {
                result = await google.ExchangeAuthCodeAsync(req.Code, req.CodeVerifier, req.RedirectUri, ct);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Google code exchange failed during calendar connect");
                return Results.StatusCode(502);
            }

            if (!result.Success)
            {
                log.LogWarning("Google rejected the calendar connect code exchange ({Status})", result.StatusCode);
                return Results.BadRequest(new { error = "exchange_failed" });
            }
            if (string.IsNullOrEmpty(result.Tokens?.RefreshToken))
            {
                log.LogWarning("Google calendar connect returned no refresh token; re-consent required");
                return Results.BadRequest(new { error = "reconsent_required" });
            }

            var email = JwtClaims.TryGetClaim(result.Tokens.IdToken, "email");
            return await CompleteConnectAsync(
                store, workspaceHandler, currentUser.UserId, currentWorkspace.WorkspaceId,
                Google, result.Tokens.RefreshToken, email, log, ct);
        }).RequireAuthorization();

        scoped.MapPost("/calendar/connect/microsoft", async (
            CalendarConnectRequest req, IMicrosoftOAuthClient microsoft, ICalendarTokenStore store,
            ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, IWorkspaceCommandHandler workspaceHandler,
            ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Api.Calendar.Connect");
            if (string.IsNullOrEmpty(req.Code) || string.IsNullOrEmpty(req.CodeVerifier) || string.IsNullOrEmpty(req.RedirectUri))
                return Results.BadRequest(new { error = "invalid_request" });

            MicrosoftTokenResult result;
            try
            {
                result = await microsoft.ExchangeAuthCodeAsync(req.Code, req.CodeVerifier, req.RedirectUri, ct);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Microsoft code exchange failed during calendar connect");
                return Results.StatusCode(502);
            }

            if (!result.Success)
            {
                log.LogWarning("Microsoft rejected the calendar connect code exchange ({Status})", result.StatusCode);
                return Results.BadRequest(new { error = "exchange_failed" });
            }
            if (string.IsNullOrEmpty(result.Tokens?.RefreshToken))
            {
                log.LogWarning("Microsoft calendar connect returned no refresh token; re-consent required");
                return Results.BadRequest(new { error = "reconsent_required" });
            }

            return await CompleteConnectAsync(
                store, workspaceHandler, currentUser.UserId, currentWorkspace.WorkspaceId,
                Microsoft, result.Tokens.RefreshToken, result.Tokens.Email, log, ct);
        }).RequireAuthorization();

        // 34-E: connect via a published ICS feed URL (no OAuth — bypasses the M365 admin-consent
        // wall). The URL is the credential, stored as the "ics" token's RefreshToken (Email null).
        scoped.MapPost("/calendar/connect/ics", async (
            IcsConnectRequest req, ICalendarTokenStore store, IHttpClientFactory httpClientFactory,
            ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, IWorkspaceCommandHandler workspaceHandler,
            ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Api.Calendar.Connect");
            var url = req.Url?.Trim();

            // SSRF guard FIRST (absolute https + no private/loopback/metadata host) — never fetch a
            // URL that fails it. invalid_request because the URL itself is rejected.
            if (!IcsUrlValidator.IsAllowed(url))
            {
                log.LogWarning("ICS connect rejected by the SSRF guard (workspace {WorkspaceId})", currentWorkspace.WorkspaceId);
                return Results.BadRequest(new { error = "invalid_request" });
            }

            // One-time validation fetch+parse: confirm the URL really serves a parseable ICS before
            // storing it, so a connect either yields meetings or fails loudly here (not silently at
            // the next meetings read). Uses a short-timeout client; any failure → invalid_feed.
            var http = httpClientFactory.CreateClient("ics-validate");
            try
            {
                using var resp = await http.GetAsync(url, ct);
                if (!resp.IsSuccessStatusCode)
                {
                    log.LogWarning("ICS connect validation fetch returned {Status} (workspace {WorkspaceId})", (int)resp.StatusCode, currentWorkspace.WorkspaceId);
                    return Results.BadRequest(new { error = "invalid_feed" });
                }
                var body = await resp.Content.ReadAsStringAsync(ct);
                _ = Calendar.Load(body);
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "ICS connect validation failed (fetch/parse) (workspace {WorkspaceId})", currentWorkspace.WorkspaceId);
                return Results.BadRequest(new { error = "invalid_feed" });
            }

            return await CompleteConnectAsync(
                store, workspaceHandler, currentUser.UserId, currentWorkspace.WorkspaceId,
                Ics, url!, email: null, log, ct);
        }).RequireAuthorization();

        scoped.MapGet("/calendar/connection", async (
            ICalendarTokenStore store, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, CancellationToken ct) =>
        {
            // Strongly-consistent point reads of the token store (NOT an async projection), keyed by
            // (user, workspace), so it never leaks another user's/workspace's connection and reflects
            // a just-completed connect without waiting on the projector (RYW). Single-provider, so at
            // most one of these is set; check Microsoft, then Google, then ICS.
            var ms = await store.GetAsync(currentUser.UserId, currentWorkspace.WorkspaceId, Microsoft, ct);
            if (ms is not null)
                return Results.Ok(new { status = "connected", provider = Microsoft, email = ms.Email });
            var google = await store.GetAsync(currentUser.UserId, currentWorkspace.WorkspaceId, Google, ct);
            if (google is not null)
                return Results.Ok(new { status = "connected", provider = Google, email = google.Email });
            var ics = await store.GetAsync(currentUser.UserId, currentWorkspace.WorkspaceId, Ics, ct);
            return ics is not null
                ? Results.Ok(new { status = "connected", provider = Ics, email = ics.Email })
                : Results.Ok(new { status = "needs_auth", provider = (string?)null, email = (string?)null });
        }).RequireAuthorization();

        // Generic disconnect (34-C): clears the workspace's connection whichever provider it is.
        scoped.MapPost("/calendar/disconnect", async (
            ICalendarTokenStore store, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace,
            IWorkspaceCommandHandler workspaceHandler, ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Api.Calendar.Connect");
            var workspaceId = currentWorkspace.WorkspaceId;
            foreach (var provider in AllProviders)
                await store.DeleteAsync(currentUser.UserId, workspaceId, provider, ct);
            await RecordDisconnectionEventAsync(workspaceHandler, workspaceId, log, ct);
            return Results.Ok(new { status = "needs_auth", provider = (string?)null });
        }).RequireAuthorization();
    }

    // Persists the new provider's token (the source of truth for reads — written first), clears the
    // OTHER provider's token so a workspace holds exactly one connection (decision #3), then records
    // the per-workspace connect event.
    private static async Task<IResult> CompleteConnectAsync(
        ICalendarTokenStore store, IWorkspaceCommandHandler workspaceHandler, string userId, string workspaceId,
        string provider, string refreshToken, string? email, ILogger log, CancellationToken ct)
    {
        // Clear the OTHER providers' tokens BEFORE writing the new one (decision #3: one provider per
        // workspace, now {google, microsoft, ics}). Delete-first matters because resolution is
        // Microsoft→Google→ICS: if we upserted a lower-priority provider then a delete of a stale
        // higher-priority token failed, the stale token would shadow the new connection. Delete-first
        // means a failure leaves the workspace unconnected (clean needs_auth), never serving the
        // wrong calendar.
        foreach (var other in AllProviders.Where(p => p != provider))
            await store.DeleteAsync(userId, workspaceId, other, ct);
        await store.UpsertAsync(userId, workspaceId, provider, refreshToken, email, ct);
        await RecordConnectionEventAsync(workspaceHandler, workspaceId, provider, email, log, ct);
        log.LogInformation(
            "Connected {Provider} calendar (workspace {WorkspaceId}, email present: {HasEmail})", provider, workspaceId, email is not null);
        return Results.Ok(new { connected = true, provider, email });
    }

    // The domain event records the per-workspace connection (provider + account) for 34-C's provider
    // resolution. NOT recorded for the reserved default workspace — its `__default__` stream is shared
    // across users, so it has no per-user aggregate instance; the token store alone carries the default
    // workspace's connection. Best-effort: the token (written first) is the source of truth for reads,
    // so a failed event append must not fail the connect.
    private static async Task RecordConnectionEventAsync(
        IWorkspaceCommandHandler workspaceHandler, string workspaceId, string provider, string? email, ILogger log, CancellationToken ct)
    {
        if (workspaceId == WorkspaceId.DefaultValue) return;
        try
        {
            await workspaceHandler.HandleAsync(new ConnectWorkspaceCalendar(new WorkspaceId(workspaceId), provider, email), ct);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Calendar connected for workspace {WorkspaceId} but recording the domain event failed", workspaceId);
        }
    }

    private static async Task RecordDisconnectionEventAsync(
        IWorkspaceCommandHandler workspaceHandler, string workspaceId, ILogger log, CancellationToken ct)
    {
        if (workspaceId == WorkspaceId.DefaultValue) return;
        try
        {
            await workspaceHandler.HandleAsync(new DisconnectWorkspaceCalendar(new WorkspaceId(workspaceId)), ct);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Calendar disconnected for workspace {WorkspaceId} but recording the domain event failed", workspaceId);
        }
    }
}

record CalendarConnectRequest(string Code, string CodeVerifier, string RedirectUri);

// 34-E: the published ICS feed URL is the only credential — no auth code/PKCE.
record IcsConnectRequest(string? Url);
