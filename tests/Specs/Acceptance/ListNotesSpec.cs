using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Specs.Acceptance;

public sealed class ListNotesSpec
{
    [Fact]
    public async Task GetNotes_returns_200_with_notes_list()
    {
        var baseUrl = Environment.GetEnvironmentVariable("API_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl)) return;

        using var client = new HttpClient();

        var created = await client.PostAsync($"{baseUrl.TrimEnd('/')}/notes", null);
        var noteId = (await created.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString();

        var response = await client.GetAsync($"{baseUrl.TrimEnd('/')}/notes");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out var items));
        Assert.True(items.GetArrayLength() > 0);

        var found = items.EnumerateArray()
            .Any(item => item.TryGetProperty("noteId", out var id) && id.GetString() == noteId);
        Assert.True(found);
    }
}
