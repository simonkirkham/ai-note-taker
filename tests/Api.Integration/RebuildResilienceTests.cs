using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EventStore.Projections;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// A factory whose title-list store can be armed to throttle a single rebuild write,
// so the rebuild's bounded-retry behaviour is exercised end to end over HTTP.
public sealed class FaultInjectingApiFactory : ApiFactory
{
    public FaultInjectingNoteTitleListStore TitleStore { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<INoteTitleListStore>();
            services.AddSingleton<INoteTitleListStore>(TitleStore);
        });
    }
}

[Collection("ProjectionRebuild")]
public sealed class RebuildResilienceTests(FaultInjectingApiFactory factory) : IClassFixture<FaultInjectingApiFactory>
{
    private readonly FaultInjectingApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Rebuild_recovers_from_a_transient_write_fault()
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();
        await _client.PatchAsync($"/notes/{noteId}/title",
            JsonContent.Create(new { title = "Resilient note" }));

        // Arm the throttle so the next title write — which happens during the rebuild — faults once.
        _factory.TitleStore.FailNextUpsert = true;

        var resp = await _client.PostAsync("/admin/projections/rebuild", null);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.False(_factory.TitleStore.FailNextUpsert); // the fault fired and was retried past

        var listResp = await _client.GetAsync("/notes");
        var items = (await listResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();
        Assert.Contains(items, i =>
            i.GetProperty("noteId").GetString() == noteId &&
            i.GetProperty("title").GetString() == "Resilient note");
    }
}
