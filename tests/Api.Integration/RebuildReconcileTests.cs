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

// Exposes the in-memory title/search/detail stores so reconcile behaviour can be asserted at the row level.
public sealed class ReconcileApiFactory : ApiFactory
{
    internal InMemoryNoteTitleListStore TitleStore { get; } = new();
    internal InMemoryNoteSearchViewStore SearchStore { get; } = new();
    internal FaultInjectingNoteDetailStore DetailStore { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<INoteTitleListStore>();
            services.AddSingleton<INoteTitleListStore>(TitleStore);
            services.RemoveAll<INoteSearchViewStore>();
            services.AddSingleton<INoteSearchViewStore>(SearchStore);
            services.RemoveAll<INoteDetailStore>();
            services.AddSingleton<INoteDetailStore>(DetailStore);
        });
    }
}

public sealed class RebuildReconcileTests(ReconcileApiFactory factory) : IClassFixture<ReconcileApiFactory>
{
    private readonly ReconcileApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<NoteId> CreateNoteAsync(string title)
    {
        var create = await _client.PostAsync("/notes", null);
        var id = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        await _client.PatchAsync($"/notes/{id}/title", JsonContent.Create(new { title }));
        return new NoteId(Guid.Parse(id));
    }

    [Fact]
    public async Task Rebuild_reconcile_removes_a_stale_row_with_no_backing_events()
    {
        var real = await CreateNoteAsync("Real note");

        // A stale row with no backing events — a deleted-note orphan a delete-first rebuild would
        // have wiped, but an upsert-only rebuild would otherwise leave behind.
        var orphan = new NoteId(Guid.NewGuid());
        await _factory.TitleStore.UpsertAsync(
            new NoteTitleListItem(orphan, "Orphan", DateTimeOffset.UtcNow, FakeCurrentUser.TestUserId));

        await _client.PostAsync("/admin/projections/rebuild", null);

        var all = (await _factory.TitleStore.QueryAllAsync()).Items;
        Assert.DoesNotContain(all, i => i.NoteId == orphan);
        Assert.Contains(all, i => i.NoteId == real);
    }

    [Fact]
    public async Task Rebuild_prunes_a_pre_existing_search_tombstone()
    {
        await CreateNoteAsync("A live note");

        // A Deleted=true tombstone left in the table by an earlier rebuild — the live path hard-deletes,
        // so reconcile must prune it (the note has no live events, so it is absent from the keep-set).
        var tombstone = new NoteId(Guid.NewGuid());
        await _factory.SearchStore.UpsertAsync(new NoteSearchView(
            tombstone, FakeCurrentUser.TestUserId, "Ghost", "", "", Array.Empty<string>(), "",
            Deleted: true, DateTimeOffset.UtcNow));

        await _client.PostAsync("/admin/projections/rebuild", null);

        Assert.Null(await _factory.SearchStore.GetByNoteIdAsync(tombstone));
    }

    [Fact]
    public async Task Rebuild_is_idempotent()
    {
        await CreateNoteAsync("Note A");
        await CreateNoteAsync("Note B");

        await _client.PostAsync("/admin/projections/rebuild", null);
        var first = (await _factory.TitleStore.QueryAllAsync()).Items.Select(i => i.NoteId).OrderBy(x => x.Value).ToList();
        await _client.PostAsync("/admin/projections/rebuild", null);
        var second = (await _factory.TitleStore.QueryAllAsync()).Items.Select(i => i.NoteId).OrderBy(x => x.Value).ToList();

        Assert.Equal(first, second);
    }

    [Fact]
    public async Task A_fault_mid_rebuild_leaves_prior_rows_intact()
    {
        var noteId = await CreateNoteAsync("Survivor");
        Assert.Contains((await _factory.TitleStore.QueryAllAsync()).Items, i => i.NoteId == noteId);

        // A non-transient write fault aborts the rebuild; because nothing is deleted first, the
        // pre-existing rows must still be present.
        _factory.DetailStore.FailNextUpsert = true;
        var resp = await _client.PostAsync("/admin/projections/rebuild", null);
        Assert.Equal(HttpStatusCode.InternalServerError, resp.StatusCode);

        Assert.Contains((await _factory.TitleStore.QueryAllAsync()).Items, i => i.NoteId == noteId);
    }
}
