using System.Net;
using System.Net.Http;
using System.Text;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class ErrorResponsesSpec(DeployedApiFixture fixture)
{
    private const string AuthRequired = "SMOKE_TEST_TOKEN not configured — add the SMOKE_TEST_GOOGLE_REFRESH_TOKEN secret to the GitHub environment to enable auth smoke tests";

    [SkippableFact]
    public async Task PatchTitle_nonexistent_note_returns_404()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var body = new StringContent("{\"title\":\"x\"}", Encoding.UTF8, "application/json");
        var response = await fixture.Client.PatchAsync($"w/__default__/notes/{Guid.NewGuid()}/title", body);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [SkippableFact]
    public async Task PutContent_nonexistent_note_returns_404()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var body = new StringContent("{\"content\":\"x\"}", Encoding.UTF8, "application/json");
        var response = await fixture.Client.PutAsync($"w/__default__/notes/{Guid.NewGuid()}/content", body);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [SkippableFact]
    public async Task PatchDate_nonexistent_note_returns_404()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var body = new StringContent("{\"date\":\"2099-01-01\"}", Encoding.UTF8, "application/json");
        var response = await fixture.Client.PatchAsync($"w/__default__/notes/{Guid.NewGuid()}/date", body);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [SkippableFact]
    public async Task DeleteActionItem_nonexistent_action_returns_404()
    {
        Skip.IfNot(fixture.IsAuthenticated, AuthRequired);
        var response = await fixture.Client.DeleteAsync($"w/__default__/notes/{Guid.NewGuid()}/actions/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
