using Microsoft.Playwright;

namespace Browser.E2E;

public sealed class BrowserFixture : IAsyncLifetime
{
    private IPlaywright _playwright = null!;
    public IBrowser Browser { get; private set; } = null!;

    public string FrontendUrl { get; } =
        Environment.GetEnvironmentVariable("FRONTEND_URL")
        ?? throw new InvalidOperationException(
            "FRONTEND_URL is not set. E2E journey tests require a deployed frontend.");

    public string? ApiBaseUrl { get; } = Environment.GetEnvironmentVariable("API_URL");

    public string? E2EAuthToken { get; } = Environment.GetEnvironmentVariable("E2E_GOOGLE_ID_TOKEN");

    public async Task InitializeAsync()
    {
        // Every read of a projector-built view (notes, cards, tags, actions, folders, todos) is
        // eventually consistent since the RYW async-projection migration (phase 27-RYW): the client
        // token gate bounds its wait at ~2.6s then serves `stale`, so a cold/contended projector can
        // fold a write a few seconds after a navigation. Playwright's default 5s locator timeout then
        // reds the deploy gate on a *correct-but-lagged* projection (BUG-26 / TI-39). Raise the default
        // to 15s so a post-navigation assert comfortably outlasts the gate bound + projector catch-up.
        // Reload-tolerant helpers keep their explicit short inner timeouts and re-gate on reload.
        Assertions.SetDefaultExpectTimeout(15_000);

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
