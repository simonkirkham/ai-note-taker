using System.Net;
using System.Net.Http.Json;

namespace Api.Integration;

public sealed class AuthJwtTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task ProtectedEndpoint_WithoutAuthHeader_Returns401()
    {
        var client = factory.CreateUnauthenticatedClient();

        var resp = await client.GetAsync("/notes");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithValidTestAuth_Returns200()
    {
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/notes");

        resp.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task HealthEndpoint_WithoutAuthHeader_Returns200()
    {
        var client = factory.CreateUnauthenticatedClient();

        var resp = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task AuthTokenEndpoint_WithoutAuthHeader_ReturnsBadRequest()
    {
        var client = factory.CreateUnauthenticatedClient();

        var resp = await client.PostAsJsonAsync("/auth/token", new { });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithNonAllowlistedSub_Returns403()
    {
        var client = factory.CreateUnauthenticatedClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", "not-in-allowlist-user");

        var resp = await client.GetAsync("/notes");

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }
}
