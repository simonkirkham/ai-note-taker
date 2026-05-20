using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class TranscriptionPersistenceTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    // Scenario: Transcript is persisted when recording stops
    //   Given a Note exists
    //   When CompleteTranscription is handled with transcript text
    //   Then the endpoint returns 204
    //   And the note's transcriptText is returned by GET /notes/{id}
    [Fact]
    public async Task PostTranscription_Persists_TranscriptText()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "Action items: fix the login bug", durationSeconds = 42 }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var detail = await GetNoteAsync(noteId);
        Assert.Equal("Action items: fix the login bug", detail.GetProperty("transcriptText").GetString());
    }

    // Scenario: Re-recording overwrites the previous transcript
    //   Given a note already has a transcript
    //   When POST /notes/{id}/transcription is called again with new text
    //   Then the new text replaces the old
    [Fact]
    public async Task PostTranscription_OverwritesPreviousTranscript()
    {
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "old transcript", durationSeconds = 10 }));

        var resp = await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "new transcript", durationSeconds = 20 }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        Assert.Equal("new transcript", detail.GetProperty("transcriptText").GetString());
    }

    // Scenario: Transcript survives a page reload (GET includes transcriptText)
    [Fact]
    public async Task GetNote_IncludesTranscriptText_WhenPresent()
    {
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "meeting notes here", durationSeconds = 5 }));

        var detail = await GetNoteAsync(noteId);

        Assert.True(detail.TryGetProperty("transcriptText", out var tx));
        Assert.Equal("meeting notes here", tx.GetString());
    }

    [Fact]
    public async Task GetNote_TranscriptTextIsNull_WhenNotRecorded()
    {
        var noteId = await CreateNoteAsync();

        var detail = await GetNoteAsync(noteId);

        Assert.True(detail.TryGetProperty("transcriptText", out var tx));
        Assert.Equal(JsonValueKind.Null, tx.ValueKind);
    }

    [Fact]
    public async Task PostTranscription_NonExistentNote_Returns404()
    {
        var resp = await _client.PostAsync($"/notes/{Guid.NewGuid()}/transcription",
            Json(new { transcriptText = "text", durationSeconds = 1 }));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task PostTranscription_Unauthenticated_Returns401()
    {
        var client = factory.CreateUnauthenticatedClient();

        var resp = await client.PostAsync($"/notes/{Guid.NewGuid()}/transcription",
            Json(new { transcriptText = "text", durationSeconds = 1 }));

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private async Task<JsonElement> GetNoteAsync(string noteId)
    {
        var resp = await _client.GetAsync($"/notes/{noteId}");
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
}
