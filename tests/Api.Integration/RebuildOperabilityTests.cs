using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Domain.Notes;
using EventStore.Projections;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// A title store that, once armed, blocks its next Upsert until released — letting a test hold a
// rebuild mid-flight (so a second, overlapping rebuild can be observed being rejected).
internal sealed class GatingNoteTitleListStore : INoteTitleListStore
{
    private readonly InMemoryNoteTitleListStore _inner = new();

    public bool Armed { get; set; }
    public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public async Task UpsertAsync(NoteTitleListItem item, CancellationToken ct = default)
    {
        if (Armed)
        {
            Entered.TrySetResult();
            await Release.Task.ConfigureAwait(false);
        }
        await _inner.UpsertAsync(item, ct).ConfigureAwait(false);
    }

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default) => _inner.DeleteAsync(noteId, ct);
    public Task DeleteAllAsync(CancellationToken ct = default) => _inner.DeleteAllAsync(ct);
    public Task<NoteTitleListView> QueryAllAsync(CancellationToken ct = default) => _inner.QueryAllAsync(ct);
}

public sealed class GatingRebuildApiFactory : ApiFactory
{
    internal GatingNoteTitleListStore TitleStore { get; } = new();

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
public sealed class RebuildOperabilityTests
{
    private static async Task CreateNoteAsync(HttpClient client, string title)
    {
        var create = await client.PostAsync("/notes", null);
        var id = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();
        await client.PatchAsync($"/notes/{id}/title", JsonContent.Create(new { title }));
    }

    [Fact]
    public async Task Rebuild_returns_a_per_projection_count_map()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        await CreateNoteAsync(client, "Counted");

        var resp = await client.PostAsync("/admin/projections/rebuild", null);

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var rebuilt = body.GetProperty("rebuilt");
        Assert.Equal(JsonValueKind.Object, rebuilt.ValueKind);
        Assert.True(rebuilt.TryGetProperty("noteTitleList", out _));
        Assert.True(rebuilt.TryGetProperty("noteCardList", out _));
        Assert.True(rebuilt.TryGetProperty("noteSearchView", out _));
        Assert.Equal(JsonValueKind.Number, body.GetProperty("staleDeleted").ValueKind);
    }

    [Fact]
    public async Task Overlapping_rebuild_is_rejected_with_409()
    {
        using var factory = new GatingRebuildApiFactory();
        var client = factory.CreateClient();
        await CreateNoteAsync(client, "Gated");
        factory.TitleStore.Armed = true;

        var first = client.PostAsync("/admin/projections/rebuild", null);
        try
        {
            await factory.TitleStore.Entered.Task; // first rebuild now holds the single-flight lock

            var second = await client.PostAsync("/admin/projections/rebuild", null);
            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        }
        finally
        {
            // Always release so a failed assertion can't leave the first rebuild holding the
            // process-wide static lock — which would cascade-409 every later rebuild test.
            factory.TitleStore.Release.TrySetResult();
        }

        var firstResp = await first;
        Assert.Equal(HttpStatusCode.OK, firstResp.StatusCode);
    }
}
