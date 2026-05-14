using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class HealthEndpointSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task Health_endpoint_returns_200_with_dynamo_ok()
    {
        var response = await fixture.Client.GetAsync("health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.Equal("ok", body.GetProperty("dynamo").GetProperty("status").GetString());
    }
}
