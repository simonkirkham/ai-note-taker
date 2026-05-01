namespace Acceptance;

public sealed class DeployedApiFixture : IDisposable
{
    public HttpClient Client { get; }

    public DeployedApiFixture()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL")
            ?? throw new InvalidOperationException(
                "API_BASE_URL is not set. This suite requires a deployed API.");

        Client = new HttpClient { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/") };
    }

    public void Dispose() => Client.Dispose();
}

[CollectionDefinition("Deployed API")]
public sealed class DeployedApiCollection : ICollectionFixture<DeployedApiFixture> { }
