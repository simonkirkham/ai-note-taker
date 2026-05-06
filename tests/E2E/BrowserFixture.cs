using Microsoft.Playwright;

namespace E2E;

public sealed class BrowserFixture : IAsyncLifetime
{
    private IPlaywright _playwright = null!;
    public IBrowser Browser { get; private set; } = null!;

    public string FrontendUrl { get; } =
        Environment.GetEnvironmentVariable("FRONTEND_URL")
        ?? throw new InvalidOperationException(
            "FRONTEND_URL is not set. E2E journey tests require a deployed frontend.");

    public string? ApiBaseUrl { get; } = Environment.GetEnvironmentVariable("API_BASE_URL");

    public async Task InitializeAsync()
    {
        _playwright = await Playwright.CreateAsync();
        Browser = await _playwright.Chromium.LaunchAsync(new() { Headless = true });
    }

    public async Task DisposeAsync()
    {
        await Browser.DisposeAsync();
        _playwright.Dispose();
    }
}

[CollectionDefinition("E2E Journeys")]
public sealed class E2EJourneysCollection : ICollectionFixture<BrowserFixture> { }
