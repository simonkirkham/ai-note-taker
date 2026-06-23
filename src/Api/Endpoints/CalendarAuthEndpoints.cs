using Api.Auth;

namespace Api.Endpoints;

// Phase 34-A: in-app "Connect Google Calendar" — auth-code+PKCE exchanged server-side, the refresh
// token persisted per user in ICalendarTokenStore (keyed by sub, provider "google"). The browser
// runs the consent redirect (reusing the sign-in PKCE machinery with a calendar scope) and POSTs the
// code here. All routes require auth: `sub` comes from the validated bearer, never request input.
public static class CalendarAuthEndpoints
{
    private const string Provider = "google";

    public static void MapCalendarAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/calendar/connect/google", async (
            CalendarConnectRequest req, IGoogleOAuthClient google, ICalendarTokenStore store,
            ICurrentUser currentUser, ILoggerFactory loggerFactory, CancellationToken ct) =>
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

            var email = JwtClaims.TryGetClaim(result.Tokens.IdToken, "email");
            await store.UpsertAsync(currentUser.UserId, Provider, result.Tokens.RefreshToken, email, ct);
            log.LogInformation("Connected Google calendar for the current user (email present: {HasEmail})", email is not null);

            return Results.Ok(new { connected = true, provider = Provider, email });
        }).RequireAuthorization();

        app.MapGet("/calendar/connection", async (
            ICalendarTokenStore store, ICurrentUser currentUser, CancellationToken ct) =>
        {
            // Strongly-consistent point read of the token store (NOT an async projection) — authz is
            // the bearer's `sub`, so this never leaks another user's connection.
            var token = await store.GetAsync(currentUser.UserId, Provider, ct);
            return token is null
                ? Results.Ok(new { status = "needs_auth", provider = Provider, email = (string?)null })
                : Results.Ok(new { status = "connected", provider = Provider, email = token.Email });
        }).RequireAuthorization();

        app.MapPost("/calendar/disconnect/google", async (
            ICalendarTokenStore store, ICurrentUser currentUser, CancellationToken ct) =>
        {
            await store.DeleteAsync(currentUser.UserId, Provider, ct);
            return Results.Ok(new { status = "needs_auth", provider = Provider });
        }).RequireAuthorization();
    }
}

record CalendarConnectRequest(string Code, string CodeVerifier, string RedirectUri);
