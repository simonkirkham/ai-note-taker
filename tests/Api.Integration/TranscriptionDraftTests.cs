using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

public sealed class TranscriptionDraftTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PutDraft_saves_without_an_event_and_GetNote_exposes_it()
    {
        var noteId = await CreateNoteAsync();

        var put = await PutDraftAsync(noteId, "Speaker 1: Half a meeting", 12);
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);

        var body = await GetNoteAsync(noteId);
        Assert.Equal("Speaker 1: Half a meeting", body.GetProperty("transcriptDraft").GetProperty("text").GetString());
        // No TranscriptionCompleted was appended: the committed transcript is still empty.
        Assert.True(IsNullOrAbsent(body, "transcriptText"));
    }

    [Fact]
    public async Task PutDraft_twice_keeps_only_the_latest()
    {
        var noteId = await CreateNoteAsync();

        await PutDraftAsync(noteId, "first", 5);
        await PutDraftAsync(noteId, "first and second", 10);

        var body = await GetNoteAsync(noteId);
        Assert.Equal("first and second", body.GetProperty("transcriptDraft").GetProperty("text").GetString());
    }

    [Fact]
    public async Task CompletingTranscription_clears_the_draft_and_commits_the_text()
    {
        var noteId = await CreateNoteAsync();
        await PutDraftAsync(noteId, "in progress", 8);

        var post = await _client.PostAsync($"/notes/{noteId}/transcription",
            JsonContent.Create(new { transcriptText = "final transcript", durationSeconds = 30 }));
        Assert.Equal(HttpStatusCode.NoContent, post.StatusCode);

        var body = await GetNoteAsync(noteId);
        Assert.Equal("final transcript", body.GetProperty("transcriptText").GetString());
        Assert.True(IsNullOrAbsent(body, "transcriptDraft"));
    }

    [Fact]
    public async Task DeleteDraft_removes_it_without_touching_the_committed_transcript()
    {
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            JsonContent.Create(new { transcriptText = "committed", durationSeconds = 20 }));
        await PutDraftAsync(noteId, "committed plus more unsaved", 25);

        var del = await _client.DeleteAsync($"/notes/{noteId}/transcription/draft");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var body = await GetNoteAsync(noteId);
        Assert.True(IsNullOrAbsent(body, "transcriptDraft"));
        Assert.Equal("committed", body.GetProperty("transcriptText").GetString());
    }

    [Fact]
    public async Task Draft_that_is_a_prefix_of_the_committed_transcript_is_not_offered()
    {
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            JsonContent.Create(new { transcriptText = "the whole thing", durationSeconds = 40 }));
        // Simulate a stale draft left by a failed post-commit delete: re-save a draft
        // that is a prefix of the committed transcript. It must be treated as committed.
        await PutDraftAsync(noteId, "the whole", 35);

        var body = await GetNoteAsync(noteId);
        Assert.True(IsNullOrAbsent(body, "transcriptDraft"));
    }

    [Fact]
    public async Task PutDraft_on_another_users_note_returns_404()
    {
        var noteId = await CreateNoteAsync();
        var other = _factory.CreateClientAsOtherUser();

        var put = await other.PutAsync($"/notes/{noteId}/transcription/draft",
            JsonContent.Create(new { transcriptText = "snoop", durationSeconds = 3 }));

        Assert.Equal(HttpStatusCode.NotFound, put.StatusCode);
    }

    [Fact]
    public async Task DeleteDraft_on_another_users_note_returns_404()
    {
        var noteId = await CreateNoteAsync();
        var other = _factory.CreateClientAsOtherUser();

        var del = await other.DeleteAsync($"/notes/{noteId}/transcription/draft");

        Assert.Equal(HttpStatusCode.NotFound, del.StatusCode);
    }

    [Fact]
    public async Task PutDraft_with_blank_text_returns_422()
    {
        var noteId = await CreateNoteAsync();

        var put = await _client.PutAsync($"/notes/{noteId}/transcription/draft",
            JsonContent.Create(new { transcriptText = "   ", durationSeconds = 1 }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, put.StatusCode);
    }

    private async Task<string> CreateNoteAsync()
    {
        var create = await _client.PostAsync("/notes", null);
        return (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private Task<HttpResponseMessage> PutDraftAsync(string noteId, string text, int durationSeconds) =>
        _client.PutAsync($"/notes/{noteId}/transcription/draft",
            JsonContent.Create(new { transcriptText = text, durationSeconds }));

    private async Task<JsonElement> GetNoteAsync(string noteId)
    {
        var resp = await _client.GetAsync($"/notes/{noteId}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    // A field is "no value" whether the serializer emits it as null or omits it entirely.
    private static bool IsNullOrAbsent(JsonElement body, string property) =>
        !body.TryGetProperty(property, out var value) || value.ValueKind == JsonValueKind.Null;
}
