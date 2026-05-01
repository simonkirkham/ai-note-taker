using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace ApiIntegration;

public sealed class ApiIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetHealth_Returns200WithStatusOkAndDynamoOk()
    {
        var resp = await _client.GetAsync("/health");

        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.Equal("ok", body.GetProperty("dynamo").GetProperty("status").GetString());
    }

    [Fact]
    public async Task PostNotes_Returns201WithNoteId()
    {
        var resp = await _client.PostAsync("/notes", null);

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(Guid.TryParse(body.GetProperty("noteId").GetString(), out _));
    }

    [Fact]
    public async Task PostNotes_WithDuplicateNoteId_Returns409()
    {
        var create = await _client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = body.GetProperty("noteId").GetString();

        var json = new StringContent($"{{\"noteId\":\"{noteId}\"}}", Encoding.UTF8, "application/json");
        var resp = await _client.PostAsync("/notes", json);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task PatchNoteTitle_ExistingNote_Returns200()
    {
        var create = await _client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = body.GetProperty("noteId").GetString();

        var patch = new StringContent("{\"title\":\"My Note\"}", Encoding.UTF8, "application/json");
        var resp = await _client.PatchAsync($"/notes/{noteId}/title", patch);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task PatchNoteTitle_NonExistentNote_Returns404()
    {
        var patch = new StringContent("{\"title\":\"Ghost\"}", Encoding.UTF8, "application/json");
        var resp = await _client.PatchAsync($"/notes/{Guid.NewGuid()}/title", patch);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task GetNotes_ReturnsItemsContainingCreatedNote()
    {
        var create = await _client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var createdNoteId = body.GetProperty("noteId").GetString();

        var resp = await _client.GetAsync("/notes");

        resp.EnsureSuccessStatusCode();
        var listBody = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = listBody.GetProperty("items").EnumerateArray();
        Assert.Contains(items, i => i.GetProperty("noteId").GetString() == createdNoteId);
    }
}
