using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Specs.Acceptance;

/// <summary>
/// Acceptance spec for the deployed Lambda health endpoint.
/// Requires API_BASE_URL env var pointing at the live API Gateway URL.
/// When absent the spec is a no-op so the local suite stays green.
/// </summary>
public sealed class HealthEndpointSpec
{
    [Fact]
    public async Task Health_endpoint_returns_200_with_status_ok()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL");
        console.WriteLine($"API_BASE_URL: {baseUrl}");
        
        if (string.IsNullOrWhiteSpace(baseUrl))
            return;

        using var client = new HttpClient();
        var response = await client.GetAsync($"{baseUrl.TrimEnd('/')}/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
    }
}
