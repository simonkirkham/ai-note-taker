using System.Net;
using System.Net.Http.Json;
using Api.Observability;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// Proves the auth endpoints emit the sign-in / session-refresh signals that make
// "asked to log in a lot" measurable. The EMF push itself is static, so — per the
// 12-B pattern — assertions run against the IDomainMetrics seam via a recording fake.
[Collection("AuthEnv")]
public sealed class AuthObservabilityTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private (HttpClient Client, RecordingDomainMetrics Metrics, FakeGoogleOAuthClient Google) Setup()
    {
        var metrics = new RecordingDomainMetrics();
        var derived = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<IDomainMetrics>();
                services.AddSingleton<IDomainMetrics>(metrics);
            }));
        var google = derived.Services.GetRequiredService<FakeGoogleOAuthClient>();
        google.Reset();
        return (derived.CreateClient(), metrics, google);
    }

    [Fact]
    public async Task SignIn_WhenGoogleIssuesRefreshToken_RecordsConsentIssued()
    {
        var (client, metrics, google) = Setup();
        google.ExchangeResult = FakeGoogleOAuthClient.Success("an-id-token", "a-refresh-token");

        var body = new { code = "auth-code", codeVerifier = "verifier", redirectUri = "https://example.com" };
        var response = await client.PostAsJsonAsync("/auth/token", body);

        response.EnsureSuccessStatusCode();
        Assert.Equal(new[] { true }, metrics.SignIns);
    }

    [Fact]
    public async Task SignIn_WhenGoogleReturnsNoRefreshToken_RecordsSilentSignIn()
    {
        var (client, metrics, google) = Setup();
        google.ExchangeResult = FakeGoogleOAuthClient.Success("an-id-token", null);

        var body = new { code = "auth-code", codeVerifier = "verifier", redirectUri = "https://example.com" };
        var response = await client.PostAsJsonAsync("/auth/token", body);

        response.EnsureSuccessStatusCode();
        Assert.Equal(new[] { false }, metrics.SignIns);
    }

    [Fact]
    public async Task SessionRefresh_WithNoCookie_RecordsNoCookieOutcome()
    {
        var (client, metrics, _) = Setup();

        var response = await client.PostAsync("/auth/refresh", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(new[] { "no_cookie" }, metrics.SessionRefreshes);
    }

    [Fact]
    public async Task SessionRefresh_WithValidCookie_RecordsCompleted()
    {
        var (client, metrics, google) = Setup();
        google.RefreshResult = FakeGoogleOAuthClient.Success("rotated-id-token", null);

        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", "rt=stored-refresh-token");
        var response = await client.SendAsync(request);

        response.EnsureSuccessStatusCode();
        Assert.Equal(new[] { "completed" }, metrics.SessionRefreshes);
    }

    [Fact]
    public async Task SessionRefresh_WhenGoogleRejectsToken_RecordsRejected()
    {
        var (client, metrics, google) = Setup();
        google.RefreshResult = FakeGoogleOAuthClient.Failure(400);

        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Add("Cookie", "rt=expired-refresh-token");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(new[] { "rejected" }, metrics.SessionRefreshes);
    }
}
