using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Acceptance;

[Collection("Deployed API")]
public sealed class SetNoteDateSpec(DeployedApiFixture fixture)
{
    [Fact]
    public async Task SetNoteDate_DateAppearsInGetNoteResponse()
    {
        var noteId = await CreateNoteAsync();

        var patchResp = await PatchDateAsync(noteId, "2026-04-21");
        patchResp.EnsureSuccessStatusCode();

        var getResp = await fixture.Client.GetAsync($"notes/{noteId}");
        getResp.EnsureSuccessStatusCode();
        var body = await getResp.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("2026-04-21", body.GetProperty("date").GetString());
    }

    [Fact]
    public async Task SetNoteDate_NonExistentNote_Returns404()
    {
        var resp = await PatchDateAsync(Guid.NewGuid().ToString(), "2026-04-21");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await fixture.Client.PostAsync("notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private Task<HttpResponseMessage> PatchDateAsync(string noteId, string? date)
    {
        var json = date is null ? "{\"date\":null}" : $"{{\"date\":\"{date}\"}}";
        return fixture.Client.PatchAsync(
            $"notes/{noteId}/date",
            new StringContent(json, Encoding.UTF8, "application/json"));
    }
}
