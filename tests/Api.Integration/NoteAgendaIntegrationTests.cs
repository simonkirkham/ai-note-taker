using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class NoteAgendaIntegrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PostAgendaItem_ReturnsCreatedWithItemId()
    {
        var noteId = await CreateNoteAsync();

        var resp = await PostAgendaItemAsync(noteId, "Budget (Q3)");

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.NotEqual(Guid.Empty, body.GetProperty("itemId").GetGuid());
    }

    [Fact]
    public async Task PostAgendaItem_AppearsInGetNote()
    {
        var noteId = await CreateNoteAsync();
        await PostAgendaItemAsync(noteId, "Budget (Q3)");

        var agenda = await GetAgendaAsync(noteId);

        var item = Assert.Single(agenda);
        Assert.Equal("Budget (Q3)", item.GetProperty("text").GetString());
        Assert.False(item.GetProperty("discussed").GetBoolean());
        Assert.Equal(0, item.GetProperty("position").GetInt32());
    }

    [Fact]
    public async Task PostAgendaItem_KeepsCaptureOrder()
    {
        var noteId = await CreateNoteAsync();
        await PostAgendaItemAsync(noteId, "Budget (Q3)");
        await PostAgendaItemAsync(noteId, "Hiring backfill");

        var agenda = await GetAgendaAsync(noteId);

        Assert.Equal(["Budget (Q3)", "Hiring backfill"],
            agenda.Select(a => a.GetProperty("text").GetString()!).ToArray());
        Assert.Equal([0, 1], agenda.Select(a => a.GetProperty("position").GetInt32()).ToArray());
    }

    [Fact]
    public async Task GetNote_NewNoteHasEmptyAgenda()
    {
        var noteId = await CreateNoteAsync();

        var agenda = await GetAgendaAsync(noteId);

        Assert.Empty(agenda);
    }

    [Fact]
    public async Task PostAgendaItem_BlankTextReturns400()
    {
        var noteId = await CreateNoteAsync();

        var resp = await PostAgendaItemAsync(noteId, "   ");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PostAgendaItem_NonExistentNoteReturns404()
    {
        var resp = await PostAgendaItemAsync(Guid.NewGuid().ToString(), "Budget (Q3)");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private Task<HttpResponseMessage> PostAgendaItemAsync(string noteId, string text) =>
        _client.PostAsync(
            $"/notes/{noteId}/agenda-items",
            new StringContent(JsonSerializer.Serialize(new { text }), Encoding.UTF8, "application/json"));

    private async Task<List<JsonElement>> GetAgendaAsync(string noteId)
    {
        var get = await _client.GetAsync($"/notes/{noteId}");
        get.EnsureSuccessStatusCode();
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("agenda").EnumerateArray().ToList();
    }
}
