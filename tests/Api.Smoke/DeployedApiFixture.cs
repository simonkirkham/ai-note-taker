using System.Net.Http.Headers;

namespace Api.Smoke;

public sealed class DeployedApiFixture : IDisposable
{
    public HttpClient Client { get; }
    public bool IsAuthenticated { get; }

    public DeployedApiFixture()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL")
            ?? throw new InvalidOperationException(
                "API_BASE_URL is not set. This suite requires a deployed API.");

        Client = new HttpClient { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/") };

        var token = Environment.GetEnvironmentVariable("SMOKE_TEST_TOKEN");
        if (!string.IsNullOrEmpty(token))
        {
            Client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", token);
            IsAuthenticated = true;
        }
    }

    public void Dispose() => Client.Dispose();
}

[CollectionDefinition("Deployed API")]
public sealed class DeployedApiCollection : ICollectionFixture<DeployedApiFixture> { }
