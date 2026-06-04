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

public sealed class AnalyseNoteTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly FakeBedrockAnalysisService _fakeBedrock;
    private readonly ApiFactory _factory;

    public AnalyseNoteTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        _fakeBedrock = factory.Services.GetRequiredService<FakeBedrockAnalysisService>();
        _fakeBedrock.NextResult = new NoteAnalysisResult("", [], [], [], []);
    }

    // Scenario: Analysis writes a separate Final notes artifact, not over my notes
    [Fact]
    public async Task PostAnalyse_RecordsSummary_DoesNotEditContent_Returns204()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            Summary: "The team discussed the login bug and agreed a fix.",
            DiscussionPoints: ["Login fails on Friday", "Alice owns the fix"],
            Decisions: ["Ship the fix by Friday"],
            NewTags: ["login", "auth"],
            NewActionItems: ["Fix login bug by Friday"],
            ModelId: "amazon.nova-lite-v1:0",
            PromptVersion: "analysis@v2");

        var noteId = await CreateNoteWithTranscriptAsync(
            content: "My private notes.",
            transcript: "We agreed to fix login by Friday. Alice will fix it.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var detail = await GetNoteAsync(noteId);
        Assert.Equal("My private notes.", detail.GetProperty("content").GetString());
        Assert.Equal("The team discussed the login bug and agreed a fix.", detail.GetProperty("summary").GetString());
        var discussion = detail.GetProperty("discussionPoints").EnumerateArray().Select(p => p.GetString()).ToList();
        Assert.Contains("Login fails on Friday", discussion);
        var decisions = detail.GetProperty("decisions").EnumerateArray().Select(d => d.GetString()).ToList();
        Assert.Contains("Ship the fix by Friday", decisions);
        Assert.Equal("amazon.nova-lite-v1:0", detail.GetProperty("summaryModelId").GetString());
        Assert.Equal("analysis@v2", detail.GetProperty("summaryPromptVersion").GetString());

        var events = await ReadStreamAsync(noteId);
        Assert.Single(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
        // The only ContentEdited is the user's own PUT /content; analysis adds none.
        Assert.Single(events, e => e.EventType == nameof(ContentEdited));

        var tags = detail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("login", tags);
        var actions = await GetActionsAsync(noteId);
        Assert.Contains(actions, a => a.GetProperty("description").GetString()!.Contains("Fix login bug"));
    }

    // Scenario: Re-running analysis replaces the Final notes (latest wins), both events remain in the stream
    [Fact]
    public async Task PostAnalyse_RerunReplacesSummary_LatestWins()
    {
        var noteId = await CreateNoteWithTranscriptAsync(content: "Notes.", transcript: "A meeting happened.");

        _fakeBedrock.NextResult = new NoteAnalysisResult("First summary", ["a"], [], [], []);
        await _client.PostAsync($"/notes/{noteId}/analyse", null);

        _fakeBedrock.NextResult = new NoteAnalysisResult("Second summary", ["b"], [], [], []);
        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        Assert.Equal("Second summary", detail.GetProperty("summary").GetString());

        var events = await ReadStreamAsync(noteId);
        Assert.Equal(2, events.Count(e => e.EventType == nameof(AnalysisSummaryRecorded)));
    }

    // Scenario: A note never analysed shows an empty Final notes state, not an error
    [Fact]
    public async Task GetNote_NeverAnalysed_HasNullSummaryAndEmptyLists()
    {
        var noteId = await CreateNoteWithContentAsync("Some notes I typed.");

        var detail = await GetNoteAsync(noteId);

        Assert.Equal(JsonValueKind.Null, detail.GetProperty("summary").ValueKind);
        Assert.Empty(detail.GetProperty("discussionPoints").EnumerateArray());
        Assert.Empty(detail.GetProperty("decisions").EnumerateArray());
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("summaryModelId").ValueKind);
    }

    // Scenario: Analysis runs on note content when no transcript exists (10-H)
    [Fact]
    public async Task PostAnalyse_ContentButNoTranscript_RunsAnalysis_Returns204()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            "Met with Bob about the login bug.", [], [], ["login"], ["Follow up with Bob"]);

        var noteId = await CreateNoteWithContentAsync("Met with Bob about the login bug.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        var tags = detail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("login", tags);
        var actions = await GetActionsAsync(noteId);
        Assert.Contains(actions, a => a.GetProperty("description").GetString()!.Contains("Follow up with Bob"));
    }

    // Scenario: Analysis requires something to analyse — empty content and no transcript (10-H)
    [Fact]
    public async Task PostAnalyse_NoContentAndNoTranscript_Returns422()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    // Scenario: Whitespace-only content with no transcript is treated as nothing to analyse (10-H)
    [Fact]
    public async Task PostAnalyse_WhitespaceContentNoTranscript_Returns422()
    {
        var noteId = await CreateNoteWithContentAsync("   ");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    // Scenario: Content is left byte-for-byte untouched even when the model returns a summary
    [Fact]
    public async Task PostAnalyse_LeavesQuickNotesUnchanged_StillTagsAndActions()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            "A SUMMARY THE MODEL WROTE", [], [], ["login"], ["Fix the login bug"]);

        var noteId = await CreateNoteWithTranscriptAsync(
            content: "My private notes.", transcript: "Alice will fix login.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        Assert.Equal("My private notes.", detail.GetProperty("content").GetString());
        var events = await ReadStreamAsync(noteId);
        // The only ContentEdited is the user's own PUT /content; analysis never edits content.
        Assert.Single(events, e => e.EventType == nameof(ContentEdited));
        var tags = detail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("login", tags);
        var actions = await GetActionsAsync(noteId);
        Assert.Contains(actions, a => a.GetProperty("description").GetString()!.Contains("Fix the login bug"));
    }

    // Scenario: Both note content and transcript are passed to the analysis service (10-H)
    [Fact]
    public async Task PostAnalyse_PassesContentAndTranscriptToService()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("unchanged", [], [], [], []);

        var noteId = await CreateNoteWithTranscriptAsync(
            content: "Login bug.", transcript: "Alice will fix it by Friday.");

        await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.NotNull(_fakeBedrock.LastRequest);
        Assert.Equal("Login bug.", _fakeBedrock.LastRequest!.ExistingContent);
        Assert.Equal("Alice will fix it by Friday.", _fakeBedrock.LastRequest.TranscriptText);
    }

    // Scenario: Malformed model output never corrupts the note — empty summary, no throw, content untouched
    [Fact]
    public async Task PostAnalyse_EmptySummary_NoThrow_ContentAndStreamUntouched()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("", [], [], [], []);

        var noteId = await CreateNoteWithTranscriptAsync(content: "My notes.", transcript: "garbled.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        Assert.Equal("My notes.", detail.GetProperty("content").GetString());
        Assert.Equal("", detail.GetProperty("summary").GetString());
        var events = await ReadStreamAsync(noteId);
        // The only ContentEdited is the user's own PUT /content; the empty-summary analysis adds none.
        Assert.Single(events, e => e.EventType == nameof(ContentEdited));
        Assert.Single(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
    }

    // Scenario: Analysis requires authentication
    [Fact]
    public async Task PostAnalyse_Unauthenticated_Returns401()
    {
        var unauthClient = _factory.CreateUnauthenticatedClient();

        var resp = await unauthClient.PostAsync($"/notes/{Guid.NewGuid()}/analyse", null);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // Scenario: Analysis on non-existent note returns 404
    [Fact]
    public async Task PostAnalyse_NoteNotFound_Returns404()
    {
        var resp = await _client.PostAsync($"/notes/{Guid.NewGuid()}/analyse", null);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // Scenario: Analysis on another user's note returns 404
    [Fact]
    public async Task PostAnalyse_OtherUsersNote_Returns404()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("updated", [], [], [], []);
        var noteId = await CreateNoteWithTranscriptAsync("original", "transcript");

        var otherClient = _factory.CreateClientAsOtherUser();
        var resp = await otherClient.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // Scenario: Tags already on the note are not duplicated
    [Fact]
    public async Task PostAnalyse_ExistingTagNotDuplicated()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], ["login"], []);

        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "Login discussion", durationSeconds = 10 }));
        await _client.PostAsync($"/notes/{noteId}/tags", Json(new { tag = "login" }));

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        var tags = detail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Single(tags, t => t == "login");
    }

    // Scenario: Re-analysing with the same action item text does not produce duplicates
    [Fact]
    public async Task PostAnalyse_ExistingActionItemNotDuplicated()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], [], ["Fix login bug by Friday"]);

        var noteId = await CreateNoteWithTranscriptAsync("same content", "Fix login bug by Friday");
        await _client.PostAsync($"/notes/{noteId}/analyse", null);

        // Second call with the same action item
        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var actions = await GetActionsAsync(noteId);
        Assert.Single(actions, a => a.GetProperty("description").GetString()!.Contains("Fix login bug"));
    }

    // Scenario: Bedrock failure returns 503 and records nothing
    [Fact]
    public async Task PostAnalyse_WhenBedrockThrows_Returns503_RecordsNothing()
    {
        var throwingFactory = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IBedrockAnalysisService>();
            s.AddSingleton<IBedrockAnalysisService, ThrowingBedrockAnalysisService>();
        }));
        var client = throwingFactory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteResp = await client.PostAsync("/notes", null);
        noteResp.EnsureSuccessStatusCode();
        var noteId = (await noteResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        await client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "some transcript", durationSeconds = 10 }));

        var resp = await client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        var events = await ReadStreamAsync(noteId);
        Assert.DoesNotContain(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
    }

    // Scenario: Analysis records only the newly-applied AI tags as TagsSuggested, before NoteTagged (10-I);
    // the event is the v2 shape stamped with the run's model id and prompt version (10-M).
    [Fact]
    public async Task PostAnalyse_RecordsOnlyNewTagsAsSuggested_BeforeNoteTagged()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], ["auth", "login"], [],
            ModelId: "amazon.nova-lite-v1:0", PromptVersion: "analysis@v2");

        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "login and auth discussion", durationSeconds = 10 }));
        await _client.PostAsync($"/notes/{noteId}/tags", Json(new { tag = "auth" }));

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var events = await ReadStreamAsync(noteId);
        var suggestedEnvelope = Assert.Single(events, e => e.EventType == nameof(TagsSuggested));
        Assert.Equal(2, suggestedEnvelope.EventVersion);
        var suggested = (TagsSuggestedV2)EventDeserializer.Deserialize(suggestedEnvelope);
        Assert.Equal(new[] { "login" }, suggested.Tags);
        Assert.Equal("amazon.nova-lite-v1:0", suggested.ModelId);
        Assert.Equal("analysis@v2", suggested.PromptVersion);

        var taggedLoginEnvelope = Assert.Single(events, e =>
            e.EventType == nameof(NoteTagged) &&
            ((NoteTagged)EventDeserializer.Deserialize(e)).Tag == "login");
        Assert.True(suggestedEnvelope.SequenceNumber < taggedLoginEnvelope.SequenceNumber);
    }

    // Scenario: No new tags means no TagsSuggested event is recorded (10-I)
    [Fact]
    public async Task PostAnalyse_NoNewTags_RecordsNoTagsSuggested()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], ["auth"], []);

        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "auth discussion", durationSeconds = 10 }));
        await _client.PostAsync($"/notes/{noteId}/tags", Json(new { tag = "auth" }));

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var events = await ReadStreamAsync(noteId);
        Assert.DoesNotContain(events, e => e.EventType == nameof(TagsSuggested));
    }

    // Scenario: Analysis records the IDs of the action items it created (10-K); the event is the v2
    // shape stamped with the run's model id and prompt version (10-M).
    [Fact]
    public async Task PostAnalyse_RecordsCreatedActionItemIds_AsActionItemsSuggested()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], [], ["Fix the login bug by Friday"],
            ModelId: "amazon.nova-lite-v1:0", PromptVersion: "analysis@v2");

        var noteId = await CreateNoteWithTranscriptAsync(content: "Login bug.", transcript: "Alice will fix login by Friday.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var events = await ReadStreamAsync(noteId);
        var suggestedEnvelope = Assert.Single(events, e => e.EventType == nameof(ActionItemsSuggested));
        Assert.Equal(2, suggestedEnvelope.EventVersion);
        var suggested = (ActionItemsSuggestedV2)EventDeserializer.Deserialize(suggestedEnvelope);
        Assert.Single(suggested.ActionItemIds);
        Assert.Equal("amazon.nova-lite-v1:0", suggested.ModelId);
        Assert.Equal("analysis@v2", suggested.PromptVersion);

        var actions = await GetActionsAsync(noteId);
        var actionIds = actions.Select(a => a.GetProperty("actionId").GetString()).ToList();
        Assert.Contains(suggested.ActionItemIds[0].ToString(), actionIds);
    }

    // Scenario: No new action items means no ActionItemsSuggested event (10-K)
    [Fact]
    public async Task PostAnalyse_NoNewActionItems_RecordsNoActionItemsSuggested()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], [], []);

        var noteId = await CreateNoteWithTranscriptAsync(content: "Login bug.", transcript: "nothing actionable here.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var events = await ReadStreamAsync(noteId);
        Assert.DoesNotContain(events, e => e.EventType == nameof(ActionItemsSuggested));
    }

    private async Task<IReadOnlyList<EventEnvelope>> ReadStreamAsync(string noteId)
    {
        var store = _factory.Services.GetRequiredService<IEventStore>();
        return await store.ReadAsync($"note#{noteId}");
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private async Task<string> CreateNoteWithTranscriptAsync(string content, string transcript)
    {
        var noteId = await CreateNoteAsync();
        await _client.PutAsync($"/notes/{noteId}/content", Json(new { content }));
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = transcript, durationSeconds = 30 }));
        return noteId;
    }

    private async Task<string> CreateNoteWithContentAsync(string content)
    {
        var noteId = await CreateNoteAsync();
        await _client.PutAsync($"/notes/{noteId}/content", Json(new { content }));
        return noteId;
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
