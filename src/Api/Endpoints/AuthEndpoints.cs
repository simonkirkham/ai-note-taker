using System.Text.Json;
using Api.Auth;
using Api.Observability;

namespace Api.Endpoints;

public static class AuthEndpoints
{
    private const string RefreshCookieName = "rt";
    // Browser-visible path: a CloudFront function strips the /api prefix before the origin,
    // so the cookie must be scoped to /api/auth to be sent on /api/auth/token and /api/auth/refresh.
    private const string RefreshCookiePath = "/api/auth";

    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/auth/token", async (TokenExchangeRequest req, HttpContext ctx, IGoogleOAuthClient google, IRefreshTokenStore tokenStore, IDomainMetrics metrics, ILoggerFactory loggerFactory) =>
        {
            var log = loggerFactory.CreateLogger("Api.Auth.Token");

            if (string.IsNullOrEmpty(req.Code) || string.IsNullOrEmpty(req.CodeVerifier) || string.IsNullOrEmpty(req.RedirectUri))
                return Results.BadRequest();

            if (!SecretsConfigured())
                return Results.StatusCode(503);

            try
            {
                var result = await google.ExchangeAuthCodeAsync(req.Code, req.CodeVerifier, req.RedirectUri, ctx.RequestAborted);
                if (!result.Success)
                    return Results.StatusCode(result.StatusCode);
                if (result.Tokens?.IdToken is null)
                    return Results.Problem("No id_token in Google response");

                var sub = TryGetSub(result.Tokens.IdToken);

                if (!string.IsNullOrEmpty(result.Tokens.RefreshToken))
                {
                    // First-ever sign-in (or any consent): Google issued a refresh token. Persist
                    // the durable server-side copy keyed by `sub`, then set the cookie from it.
                    if (!string.IsNullOrEmpty(sub))
                    {
                        try
                        {
                            await tokenStore.UpsertAsync(sub, result.Tokens.RefreshToken, ctx.RequestAborted);
                        }
                        catch (Exception ex)
                        {
                            // The cookie still works for this session; durability is what is lost.
                            // Surface it rather than failing the sign-in.
                            log.LogWarning(ex, "Refresh-token store write failed for sub {Sub}", sub);
                        }
                    }
                    SetRefreshCookie(ctx, result.Tokens.RefreshToken);
                }
                else if (!string.IsNullOrEmpty(sub))
                {
                    // Returning, prompt-less sign-in: Google returned no refresh token. Restore the
                    // cookie from the server-side store so the session stays long-lived without consent.
                    var stored = await tokenStore.GetAsync(sub, ctx.RequestAborted);
                    if (!string.IsNullOrEmpty(stored))
                    {
                        SetRefreshCookie(ctx, stored);
                        log.LogDebug("Session restored from server-side token for sub {Sub}", sub);
                    }
                }

                // A returned refresh_token means Google issued a fresh grant — i.e. the user was shown
                // the full consent screen. Logging + counting this is how "asked to log in a lot" becomes
                // measurable; the token itself is never logged, only the boolean outcome + sub.
                var consentIssued = !string.IsNullOrEmpty(result.Tokens.RefreshToken);
                metrics.SignInCompleted(consentIssued);
                log.LogInformation("Sign-in completed for sub {Sub}; consentIssued={ConsentIssued}", sub, consentIssued);

                return Results.Ok(new { id_token = result.Tokens.IdToken });
            }
            catch (TaskCanceledException)
            {
                return Results.StatusCode(504);
            }
            catch (HttpRequestException)
            {
                return Results.StatusCode(502);
            }
        }).AllowAnonymous();

        app.MapPost("/auth/refresh", async (HttpContext ctx, IGoogleOAuthClient google, IRefreshTokenStore tokenStore, IDomainMetrics metrics, ILoggerFactory loggerFactory) =>
        {
            var log = loggerFactory.CreateLogger("Api.Auth.Refresh");

            var refreshToken = ctx.Request.Cookies[RefreshCookieName];
            if (string.IsNullOrEmpty(refreshToken))
            {
                // No rt cookie → the client cannot slide its session and is forced back to sign-in.
                // This is the silent forced-login path that leaves no other trace (30-D would close it).
                metrics.SessionRefresh("no_cookie");
                log.LogInformation("Session refresh: no rt cookie present; client must sign in again");
                return Results.Unauthorized();
            }

            if (!SecretsConfigured())
                return Results.StatusCode(503);

            // Resolve the user's `sub` from the request's id_token (if present) so a revoked
            // token can be evicted from the store, and a rotated one persisted. The store is
            // keyed by `sub`; without it we can still serve the session but cannot touch the store.
            var sub = TryGetSubFromAuthorization(ctx);

            try
            {
                var result = await google.RefreshAsync(refreshToken, ctx.RequestAborted);
                // A failed refresh means the session is genuinely over — surface 401, not 500.
                if (!result.Success || result.Tokens?.IdToken is null)
                {
                    // Google rejected the token (revoked/expired). Evict the durable copy so the
                    // next sign-in legitimately re-consents instead of restoring a dead token —
                    // but ONLY when the rejected cookie token IS the stored copy. This endpoint is
                    // anonymous and `sub` is decoded without signature validation, so a forged `sub`
                    // must not be able to delete another user's token. Requiring the presented token
                    // to match the stored one proves the caller actually held the credential being
                    // evicted (an attacker cannot know the victim's refresh token).
                    if (!string.IsNullOrEmpty(sub))
                    {
                        try
                        {
                            var stored = await tokenStore.GetAsync(sub, ctx.RequestAborted);
                            if (!string.IsNullOrEmpty(stored) && string.Equals(stored, refreshToken, StringComparison.Ordinal))
                            {
                                await tokenStore.DeleteAsync(sub, ctx.RequestAborted);
                                log.LogInformation("Stored refresh token revoked; deleted for sub {Sub}", sub);
                            }
                        }
                        catch (Exception ex)
                        {
                            // Never turn a 401 into a 500 over a best-effort cleanup.
                            log.LogWarning(ex, "Failed to delete revoked refresh token for sub {Sub}", sub);
                        }
                    }
                    // Google rejected the token → the session is genuinely over and the next sign-in
                    // will re-consent. Distinct from no_cookie so the two forced-login causes separate.
                    metrics.SessionRefresh("rejected");
                    return Results.Unauthorized();
                }

                // Re-issue the cookie on every successful refresh to slide its 30-day window
                // forward. Google usually omits a rotated refresh_token on grant_type=refresh_token,
                // so reuse the existing one; otherwise an active session would still be force-signed
                // out at the original 30-day mark. Persist a rotated token if Google sent one.
                var newRefreshToken = string.IsNullOrEmpty(result.Tokens.RefreshToken) ? refreshToken : result.Tokens.RefreshToken;
                SetRefreshCookie(ctx, newRefreshToken);

                // Keep the durable copy current when Google rotated the token.
                if (!string.IsNullOrEmpty(sub) && !string.IsNullOrEmpty(result.Tokens.RefreshToken))
                {
                    try
                    {
                        await tokenStore.UpsertAsync(sub, result.Tokens.RefreshToken, ctx.RequestAborted);
                    }
                    catch (Exception ex)
                    {
                        log.LogWarning(ex, "Refresh-token store write failed on rotation for sub {Sub}", sub);
                    }
                }

                // Silent success: the session slid forward with no user interaction. The completed vs
                // no_cookie/rejected split quantifies how often the durable session actually holds.
                metrics.SessionRefresh("completed");
                return Results.Ok(new { id_token = result.Tokens.IdToken });
            }
            catch (TaskCanceledException)
            {
                return Results.StatusCode(504);
            }
            catch (HttpRequestException)
            {
                return Results.StatusCode(502);
            }
        }).AllowAnonymous();
    }

    private static bool SecretsConfigured() =>
        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID")) &&
        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GOOGLE_CLIENT_SECRET"));

    private static void SetRefreshCookie(HttpContext ctx, string refreshToken) =>
        ctx.Response.Cookies.Append(RefreshCookieName, refreshToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = ctx.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Path = RefreshCookiePath,
            MaxAge = TimeSpan.FromDays(30),
        });

    private static string? TryGetSubFromAuthorization(HttpContext ctx)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        const string prefix = "Bearer ";
        if (string.IsNullOrEmpty(header) || !header.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return null;
        return TryGetSub(header[prefix.Length..].Trim());
    }

    // Decodes the `sub` claim from a JWT payload WITHOUT signature validation. The id_token is
    // either fetched directly from Google's token endpoint over TLS (token exchange) or already
    // validated by the bearer middleware on every other request — so it is trusted for the store
    // key only. Any malformed input yields null; this never throws.
    private static string? TryGetSub(string? jwt)
    {
        if (string.IsNullOrEmpty(jwt))
            return null;

        var firstDot = jwt.IndexOf('.');
        if (firstDot < 0)
            return null;
        var secondDot = jwt.IndexOf('.', firstDot + 1);
        if (secondDot < 0)
            return null;

        var payload = jwt.AsSpan(firstDot + 1, secondDot - firstDot - 1);
        var bytes = DecodeBase64Url(payload);
        if (bytes is null)
            return null;

        try
        {
            using var doc = JsonDocument.Parse(bytes);
            return doc.RootElement.TryGetProperty("sub", out var subEl) && subEl.ValueKind == JsonValueKind.String
                ? subEl.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static byte[]? DecodeBase64Url(ReadOnlySpan<char> value)
    {
        // base64url → base64: swap chars and pad to a multiple of 4.
        var normalized = new string(value.ToArray()).Replace('-', '+').Replace('_', '/');
        switch (normalized.Length % 4)
        {
            case 2: normalized += "=="; break;
            case 3: normalized += "="; break;
            case 1: return null;
        }
        try
        {
            return Convert.FromBase64String(normalized);
        }
        catch (FormatException)
        {
            return null;
        }
    }
}

record TokenExchangeRequest(string Code, string CodeVerifier, string RedirectUri);
