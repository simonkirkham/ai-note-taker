using System.Net;

namespace Api.Smoke;

public sealed class FrontendSmokeSpec(DeployedFrontendFixture fixture) : IClassFixture<DeployedFrontendFixture>
{
    [Fact]
    public async Task Root_serves_html()
    {
        var response = await fixture.Client.GetAsync("");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.StartsWith("text/html", response.Content.Headers.ContentType?.MediaType);
    }
}
