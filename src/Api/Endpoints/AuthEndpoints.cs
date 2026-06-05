using Api.Auth;

namespace Api.Endpoints;

public static class AuthEndpoints
{
    private const string RefreshCookieName = "rt";
    // Browser-visible path: a CloudFront function strips the /api prefix before the origin,
    // so the cookie must be scoped to /api/auth to be sent on /api/auth/token and /api/auth/refresh.
    private const string RefreshCookiePath = "/api/auth";

    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/auth/token", async (TokenExchangeRequest req, HttpContext ctx, IGoogleOAuthClient google) =>
        {
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

                if (!string.IsNullOrEmpty(result.Tokens.RefreshToken))
                    SetRefreshCookie(ctx, result.Tokens.RefreshToken);

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

        app.MapPost("/auth/refresh", async (HttpContext ctx, IGoogleOAuthClient google) =>
        {
            var refreshToken = ctx.Request.Cookies[RefreshCookieName];
            if (string.IsNullOrEmpty(refreshToken))
                return Results.Unauthorized();

            if (!SecretsConfigured())
                return Results.StatusCode(503);

            try
            {
                var result = await google.RefreshAsync(refreshToken, ctx.RequestAborted);
                // A failed refresh means the session is genuinely over — surface 401, not 500.
                if (!result.Success || result.Tokens?.IdToken is null)
                    return Results.Unauthorized();

                // Google may rotate the refresh token; persist the new one if it did.
                if (!string.IsNullOrEmpty(result.Tokens.RefreshToken))
                    SetRefreshCookie(ctx, result.Tokens.RefreshToken);

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
}

record TokenExchangeRequest(string Code, string CodeVerifier, string RedirectUri);
