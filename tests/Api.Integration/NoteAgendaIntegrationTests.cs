using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// 43-H2: the agenda is read from the note body and nowhere else. The write-endpoint tests that
// lived here went with those endpoints; what remains is the body-derived behaviour, which is now
// the whole feature.
public sealed class NoteAgendaIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetNote_NewNoteHasEmptyAgenda()
    {
        var noteId = await CreateNoteAsync();

        var agenda = await GetAgendaAsync(noteId);

        Assert.Empty(agenda);
    }

    // ── 43-F: topics derived from the note body, through the real API serialization boundary.
    // The DynamoDB round-trip test covers the store; nothing else covers `derived` on the wire.

    [Fact]
    public async Task TaskLinesInTheBody_AppearAsDerivedAgendaTopics()
    {
        var noteId = await CreateNoteAsync();

        await PutContentAsync(noteId, "- [x] Budget (Q3)\n- [ ] Hiring plan\n\nRob says cloud spend is 8% over.");

        var agenda = await GetAgendaAsync(noteId);
        Assert.Equal(2, agenda.Count);
        Assert.Equal("Budget (Q3)", agenda[0].GetProperty("text").GetString());
        Assert.True(agenda[0].GetProperty("discussed").GetBoolean());
        Assert.True(agenda[0].GetProperty("derived").GetBoolean());
        Assert.Equal("Hiring plan", agenda[1].GetProperty("text").GetString());
        Assert.False(agenda[1].GetProperty("discussed").GetBoolean());
    }

    [Fact]
    public async Task TickingInTheBody_MovesTheCoverageCount()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "- [ ] Budget (Q3)\n- [ ] Hiring plan");
        Assert.Equal(0, (await GetAgendaAsync(noteId)).Count(a => a.GetProperty("discussed").GetBoolean()));

        await PutContentAsync(noteId, "- [x] Budget (Q3)\n- [ ] Hiring plan");

        Assert.Equal(1, (await GetAgendaAsync(noteId)).Count(a => a.GetProperty("discussed").GetBoolean()));
    }

    private Task<HttpResponseMessage> PutContentAsync(string noteId, string content) =>
        _client.PutAsync(
            $"/notes/{noteId}/content",
            new StringContent(JsonSerializer.Serialize(new { content }), Encoding.UTF8, "application/json"));

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private async Task<List<JsonElement>> GetAgendaAsync(string noteId)
    {
        var get = await _client.GetAsync($"/notes/{noteId}");
        get.EnsureSuccessStatusCode();
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("agenda").EnumerateArray().ToList();
    }
}
