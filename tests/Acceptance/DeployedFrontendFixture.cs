namespace Acceptance;

public sealed class DeployedFrontendFixture : IDisposable
{
    public HttpClient Client { get; }

    public DeployedFrontendFixture()
    {
        var frontendUrl = Environment.GetEnvironmentVariable("FRONTEND_URL")
            ?? throw new InvalidOperationException(
                "FRONTEND_URL is not set. This suite requires a deployed frontend.");

        Client = new HttpClient { BaseAddress = new Uri(frontendUrl.TrimEnd('/') + "/") };
    }

    public void Dispose() => Client.Dispose();
}
