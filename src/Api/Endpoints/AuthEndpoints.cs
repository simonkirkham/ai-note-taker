using System.Net.Http;
using System.Text.Json;

namespace Api.Endpoints;

public static class AuthEndpoints
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/auth/token", async (TokenExchangeRequest req) =>
        {
            var clientId = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID") ?? "";
            var clientSecret = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_SECRET") ?? "";

            if (string.IsNullOrEmpty(req.Code) || string.IsNullOrEmpty(req.CodeVerifier) || string.IsNullOrEmpty(req.RedirectUri))
                return Results.BadRequest();

            if (string.IsNullOrEmpty(clientId) || string.IsNullOrEmpty(clientSecret))
                return Results.StatusCode(503);

            var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["code"] = req.Code,
                ["client_id"] = clientId,
                ["client_secret"] = clientSecret,
                ["redirect_uri"] = req.RedirectUri,
                ["code_verifier"] = req.CodeVerifier,
                ["grant_type"] = "authorization_code",
            });

            try
            {
                var response = await Http.PostAsync("https://oauth2.googleapis.com/token", form);
                var body = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                    return Results.StatusCode((int)response.StatusCode);

                using var doc = JsonDocument.Parse(body);
                if (!doc.RootElement.TryGetProperty("id_token", out var idTokenEl))
                    return Results.Problem("No id_token in Google response");

                return Results.Ok(new { id_token = idTokenEl.GetString() });
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
}

record TokenExchangeRequest(string Code, string CodeVerifier, string RedirectUri);
