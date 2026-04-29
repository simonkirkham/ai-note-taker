using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Specs.Acceptance;

public sealed class RenameNoteSpec
{
    [Fact]
    public async Task PatchTitle_returns_200()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl)) return;

        using var client = new HttpClient();

        var created = await client.PostAsync($"{baseUrl.TrimEnd('/')}/notes", null);
        var noteId = (await created.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();

        var body = new StringContent("{\"title\":\"My Note\"}", Encoding.UTF8, "application/json");
        var response = await client.PatchAsync($"{baseUrl.TrimEnd('/')}/notes/{noteId}/title", body);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task PatchTitle_noop_same_title_returns_200()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl)) return;

        using var client = new HttpClient();

        var created = await client.PostAsync($"{baseUrl.TrimEnd('/')}/notes", null);
        var noteId = (await created.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();

        var body = new StringContent("{\"title\":\"Same Title\"}", Encoding.UTF8, "application/json");
        await client.PatchAsync($"{baseUrl.TrimEnd('/')}/notes/{noteId}/title", body);
        var second = await client.PatchAsync($"{baseUrl.TrimEnd('/')}/notes/{noteId}/title", body);

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
    }

    [Fact]
    public async Task PatchTitle_nonexistent_note_returns_404()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl)) return;

        using var client = new HttpClient();
        var body = new StringContent("{\"title\":\"Ghost\"}", Encoding.UTF8, "application/json");
        var response = await client.PatchAsync(
            $"{baseUrl.TrimEnd('/')}/notes/{Guid.NewGuid()}/title", body);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
