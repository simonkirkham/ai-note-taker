using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

public sealed class TranscriptionCredentialsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    // Scenario: Record button starts transcription
    //   Given I am on the note screen
    //   When I press the Record button
    //   Then the GET /transcription/credentials endpoint is called
    //   And the TranscriptionPanel shows a recording indicator and elapsed timer
    [Fact]
    public async Task GetCredentials_AuthenticatedUser_Returns200WithCredentialShape()
    {
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/transcription/credentials");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("accessKeyId").GetString()));
        Assert.False(string.IsNullOrEmpty(body.GetProperty("secretAccessKey").GetString()));
        Assert.False(string.IsNullOrEmpty(body.GetProperty("sessionToken").GetString()));
        Assert.NotEqual(default, body.GetProperty("expiration").GetDateTimeOffset());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("region").GetString()));
    }

    // Scenario: Credentials endpoint requires authentication
    //   Given no valid JWT is present
    //   When GET /transcription/credentials is called
    //   Then the response is 401 Unauthorized
    [Fact]
    public async Task GetCredentials_Unauthenticated_Returns401()
    {
        var client = factory.CreateUnauthenticatedClient();

        var resp = await client.GetAsync("/transcription/credentials");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }
}
