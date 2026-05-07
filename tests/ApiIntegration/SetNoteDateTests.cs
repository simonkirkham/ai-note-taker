using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace ApiIntegration;

public sealed class SetNoteDateTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task SetNoteDate_ExistingNote_Returns200()
    {
        var noteId = await CreateNoteAsync();

        var resp = await PatchDateAsync(noteId, "2026-04-21");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task SetNoteDate_NonExistentNote_Returns404()
    {
        var resp = await PatchDateAsync(Guid.NewGuid().ToString(), "2026-04-21");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task SetNoteDate_DateAppearsInGetNoteResponse()
    {
        var noteId = await CreateNoteAsync();
        await PatchDateAsync(noteId, "2026-04-21");

        var get = await _client.GetAsync($"/notes/{noteId}");
        get.EnsureSuccessStatusCode();
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("2026-04-21", body.GetProperty("date").GetString());
    }

    [Fact]
    public async Task SetNoteDate_NullDate_ClearsDate()
    {
        var noteId = await CreateNoteAsync();
        await PatchDateAsync(noteId, "2026-04-21");

        await PatchDateAsync(noteId, null);

        var get = await _client.GetAsync($"/notes/{noteId}");
        get.EnsureSuccessStatusCode();
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();

        Assert.True(
            body.GetProperty("date").ValueKind == JsonValueKind.Null,
            "date should be null after clearing");
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private Task<HttpResponseMessage> PatchDateAsync(string noteId, string? date)
    {
        var json = date is null ? "{\"date\":null}" : $"{{\"date\":\"{date}\"}}";
        return _client.PatchAsync(
            $"/notes/{noteId}/date",
            new StringContent(json, Encoding.UTF8, "application/json"));
    }
}
