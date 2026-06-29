using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

[Collection("ProjectionRebuild")]
public sealed class RebuildTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Rebuild_returns_200()
    {
        var resp = await _client.PostAsync("/admin/projections/rebuild", null);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Rebuild_after_clearing_projections_restores_note_list()
    {
        // Create a note (goes to event store AND projections)
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();
        await _client.PatchAsync($"/notes/{noteId}/title",
            JsonContent.Create(new { title = "Rebuilt note" }));

        // Wipe projections via the rebuild endpoint's reset step
        // Simulate projection loss by clearing then rebuilding
        await _client.PostAsync("/admin/projections/rebuild", null);

        // Note must still appear in list (rebuilt from event store)
        var listResp = await _client.GetAsync("/notes");
        var items = (await listResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();

        Assert.Contains(items, i =>
            i.GetProperty("noteId").GetString() == noteId &&
            i.GetProperty("title").GetString() == "Rebuilt note");
    }

    [Fact]
    public async Task Rebuild_excludes_deleted_notes()
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();

        await _client.DeleteAsync($"/notes/{noteId}");
        await _client.PostAsync("/admin/projections/rebuild", null);

        var listResp = await _client.GetAsync("/notes");
        var items = (await listResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("items").EnumerateArray().ToList();

        Assert.DoesNotContain(items, i => i.GetProperty("noteId").GetString() == noteId);
    }

    [Fact]
    public async Task Rebuild_restores_note_detail()
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();
        await _client.PatchAsync($"/notes/{noteId}/title",
            JsonContent.Create(new { title = "Detail note" }));

        await _client.PostAsync("/admin/projections/rebuild", null);

        var detailResp = await _client.GetAsync($"/notes/{noteId}");
        detailResp.EnsureSuccessStatusCode();
        var body = await detailResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Detail note", body.GetProperty("title").GetString());
    }
}
