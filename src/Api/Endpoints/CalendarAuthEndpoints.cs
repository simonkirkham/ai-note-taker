using Api.Auth;
using Api.CommandHandlers;
using Domain.Workspaces;

namespace Api.Endpoints;

// In-app "Connect Google Calendar" — auth-code+PKCE exchanged server-side, the refresh token
// persisted in ICalendarTokenStore. 34-A keyed it by user; 34-B keys it by (user, workspace) and
// records a WorkspaceCalendarConnected/Disconnected event on the workspace's aggregate so the
// connection (and its provider) is per workspace. Mounted under `/w/{workspaceId}` so the browser's
// active workspace scopes the connect. All routes require auth: `userId` comes from the validated
// bearer, `workspaceId` from the validated route prefix — never request input.
public static class CalendarAuthEndpoints
{
    private const string Provider = "google";

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

            // No refresh token means consent didn't grant offline access (e.g. prompt=consent missing,
            // or a prior grant). The client must re-run consent with prompt=consent.
            if (string.IsNullOrEmpty(result.Tokens?.RefreshToken))
            {
                log.LogWarning("Calendar connect returned no refresh token; re-consent required");
                return Results.BadRequest(new { error = "reconsent_required" });
            }

            var workspaceId = currentWorkspace.WorkspaceId;
            var email = JwtClaims.TryGetClaim(result.Tokens.IdToken, "email");
            // The token store is the source of truth for reads — write it first.
            await store.UpsertAsync(currentUser.UserId, workspaceId, Provider, result.Tokens.RefreshToken, email, ct);
            await RecordConnectionEventAsync(workspaceHandler, workspaceId, email, log, ct);
            log.LogInformation(
                "Connected Google calendar (workspace {WorkspaceId}, email present: {HasEmail})", workspaceId, email is not null);

            return Results.Ok(new { connected = true, provider = Provider, email });
        }).RequireAuthorization();

        scoped.MapGet("/calendar/connection", async (
            ICalendarTokenStore store, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, CancellationToken ct) =>
        {
            // Strongly-consistent point read of the token store (NOT an async projection), keyed by
            // (user, workspace), so it never leaks another user's or workspace's connection and
            // reflects a just-completed connect without waiting on the projector (RYW).
            var token = await store.GetAsync(currentUser.UserId, currentWorkspace.WorkspaceId, Provider, ct);
            return token is null
                ? Results.Ok(new { status = "needs_auth", provider = Provider, email = (string?)null })
                : Results.Ok(new { status = "connected", provider = Provider, email = token.Email });
        }).RequireAuthorization();

        scoped.MapPost("/calendar/disconnect/google", async (
            ICalendarTokenStore store, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace,
            IWorkspaceCommandHandler workspaceHandler, ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Api.Calendar.Connect");
            var workspaceId = currentWorkspace.WorkspaceId;
            await store.DeleteAsync(currentUser.UserId, workspaceId, Provider, ct);
            await RecordDisconnectionEventAsync(workspaceHandler, workspaceId, log, ct);
            return Results.Ok(new { status = "needs_auth", provider = Provider });
        }).RequireAuthorization();
    }

    // The domain event records the per-workspace connection (provider + account) for 34-C's
    // provider resolution. It is NOT recorded for the reserved default workspace — its `__default__`
    // stream is shared across users, so it has no per-user aggregate instance; the token store alone
    // carries the default workspace's connection. Best-effort: the token (written first) is the
    // source of truth for reads, so a failed event append must not fail the connect.
    private static async Task RecordConnectionEventAsync(
        IWorkspaceCommandHandler workspaceHandler, string workspaceId, string? email, ILogger log, CancellationToken ct)
    {
        if (workspaceId == WorkspaceId.DefaultValue) return;
        try
        {
            await workspaceHandler.HandleAsync(new ConnectWorkspaceCalendar(new WorkspaceId(workspaceId), Provider, email), ct);
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
