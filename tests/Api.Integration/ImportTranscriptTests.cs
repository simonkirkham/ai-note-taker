using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Services;
using Domain.Notes;
using EventStore;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// Phase 38-B — paste a transcript INTO an existing note. POST /notes/{noteId}/import-transcript
// replaces the note's transcript and runs the SAME analysis pipeline as a recording (analysing the
// pasted text via transcriptOverride). (Paths are un-prefixed; ApiFactory rewrites to the default ws.)
public sealed class ImportTranscriptTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly FakeBedrockAnalysisService _fakeBedrock;
    private readonly ApiFactory _factory;

    public ImportTranscriptTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        _fakeBedrock = factory.Services.GetRequiredService<FakeBedrockAnalysisService>();
        _fakeBedrock.NextResult = new NoteAnalysisResult("", [], [], [], []);
    }

    // Sets the transcript on an existing note and analyses it (summary/tags/actions), 204 + token.
    [Fact]
    public async Task Import_IntoExistingNote_SetsTranscript_AndAnalyses_204()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            Summary: "The team agreed to ship the login fix on Friday.",
            DiscussionPoints: ["Login fails on Friday"], Decisions: ["Ship Friday"],
            NewTags: ["login"], NewActionItems: ["Fix login bug by Friday"],
            ModelId: "amazon.nova-lite-v1:0", PromptVersion: "analysis@v8");

        var noteId = await CreateNoteAsync();
        var resp = await ImportAsync(noteId, "We agreed to fix login by Friday. Alice will own it.");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var token = Assert.Single(resp.Headers.GetValues("X-Consistency-Token"));
        Assert.StartsWith($"note#{noteId}@", token);

        var detail = await GetNoteAsync(noteId);
        Assert.Equal("We agreed to fix login by Friday. Alice will own it.",
            detail.GetProperty("transcriptText").GetString());
        Assert.Equal("The team agreed to ship the login fix on Friday.", detail.GetProperty("summary").GetString());
        Assert.Contains("login", detail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()));
        var actions = await GetActionsAsync(noteId);
        Assert.Contains(actions, a => a.GetProperty("description").GetString()!.Contains("Fix login bug"));

        var events = await ReadStreamAsync(noteId);
        Assert.Single(events, e => e.EventType == nameof(TranscriptionCompleted));
        Assert.Single(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
        // The token's version is the final stream version (covers the analysis appends).
        Assert.Equal(events.Count, long.Parse(token.Split('@')[1]));
    }

    // Pasting replaces an existing transcript (e.g. from a recording) and analyses the NEW text.
    [Fact]
    public async Task Import_ReplacesExistingTranscript_AndAnalysesTheNewText()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], [], []);
        var noteId = await CreateNoteAsync();
        // Existing transcript (as a recording would leave it).
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "OLD recorded transcript", durationSeconds = 30 }));

        var resp = await ImportAsync(noteId, "NEW pasted transcript");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        Assert.Equal("NEW pasted transcript", (await GetNoteAsync(noteId)).GetProperty("transcriptText").GetString());
        // Analysis ran on the pasted text, not the stale projection transcript.
        Assert.Equal("NEW pasted transcript", _fakeBedrock.LastRequest!.TranscriptText);
    }

    // The note's typed content is preserved and passed to analysis alongside the pasted transcript.
    [Fact]
    public async Task Import_KeepsNoteContent_AndAnalysesContentPlusTranscript()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("unchanged", [], [], [], []);
        var noteId = await CreateNoteAsync();
        await _client.PutAsync($"/notes/{noteId}/content", Json(new { content = "My typed notes." }));

        await ImportAsync(noteId, "Pasted meeting transcript.");

        Assert.Equal("My typed notes.", (await GetNoteAsync(noteId)).GetProperty("content").GetString());
        Assert.Equal("My typed notes.", _fakeBedrock.LastRequest!.ExistingContent);
        Assert.Equal("Pasted meeting transcript.", _fakeBedrock.LastRequest.TranscriptText);
    }

    [Fact]
    public async Task Import_WhitespaceTranscript_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var resp = await ImportAsync(noteId, "   ");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.False(resp.Headers.Contains("X-Consistency-Token"));
    }

    [Fact]
    public async Task Import_TranscriptOverByteCap_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var resp = await ImportAsync(noteId, new string('a', 360_000)); // > 350 KB cap
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.False(resp.Headers.Contains("X-Consistency-Token"));
    }

    [Fact]
    public async Task Import_NonexistentNote_Returns404()
    {
        var resp = await ImportAsync(Guid.NewGuid().ToString(), "some transcript");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Import_OtherUsersNote_Returns404()
    {
        var noteId = await CreateNoteAsync();
        var other = _factory.CreateClientAsOtherUser();
        var resp = await other.PostAsync($"/notes/{noteId}/import-transcript",
            Json(new { transcriptText = "intruder text" }));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Import_Unauthenticated_Returns401()
    {
        var noteId = await CreateNoteAsync();
        var unauth = _factory.CreateUnauthenticatedClient();
        var resp = await unauth.PostAsync($"/notes/{noteId}/import-transcript",
            Json(new { transcriptText = "x" }));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // Bedrock failure still saves the pasted transcript (204) with no analysis recorded.
    [Fact]
    public async Task Import_WhenBedrockThrows_StillSavesTranscript_NoAnalysis()
    {
        var throwingFactory = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IBedrockAnalysisService>();
            s.AddSingleton<IBedrockAnalysisService, ThrowingBedrockAnalysisService>();
        }));
        var client = throwingFactory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteResp = await client.PostAsync("/notes", null);
        var noteId = (await noteResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        var resp = await client.PostAsync($"/notes/{noteId}/import-transcript",
            Json(new { transcriptText = "transcript that can't be analysed now" }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var store = throwingFactory.Services.GetRequiredService<IEventStore>();
        var events = await store.ReadAsync($"note#{noteId}");
        Assert.Single(events, e => e.EventType == nameof(TranscriptionCompleted));
        Assert.DoesNotContain(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
    }

    private Task<HttpResponseMessage> ImportAsync(string noteId, string transcriptText) =>
        _client.PostAsync($"/notes/{noteId}/import-transcript", Json(new { transcriptText }));

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private async Task<IReadOnlyList<EventEnvelope>> ReadStreamAsync(string noteId)
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        return await store.ReadAsync($"note#{noteId}");
    }

    private async Task<JsonElement> GetNoteAsync(string noteId)
    {
        var resp = await _client.GetAsync($"/notes/{noteId}");
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<List<JsonElement>> GetActionsAsync(string noteId)
    {
        var resp = await _client.GetAsync($"/notes/{noteId}/actions");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("actions").EnumerateArray().ToList();
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
}
