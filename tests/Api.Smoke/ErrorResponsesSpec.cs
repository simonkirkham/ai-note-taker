using System.Net;
using System.Net.Http;
using System.Text;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class ErrorResponsesSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task PatchTitle_nonexistent_note_returns_404()
    {
        var body = new StringContent("{\"title\":\"x\"}", Encoding.UTF8, "application/json");
        var response = await fixture.Client.PatchAsync($"notes/{Guid.NewGuid()}/title", body);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PutContent_nonexistent_note_returns_404()
    {
        var body = new StringContent("{\"content\":\"x\"}", Encoding.UTF8, "application/json");
        var response = await fixture.Client.PutAsync($"notes/{Guid.NewGuid()}/content", body);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PatchDate_nonexistent_note_returns_404()
    {
        var body = new StringContent("{\"date\":null}", Encoding.UTF8, "application/json");
        var response = await fixture.Client.PatchAsync($"notes/{Guid.NewGuid()}/date", body);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeleteActionItem_nonexistent_action_returns_404()
    {
        var response = await fixture.Client.DeleteAsync($"notes/{Guid.NewGuid()}/actions/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
