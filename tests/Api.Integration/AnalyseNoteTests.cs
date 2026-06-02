using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Services;
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
        _fakeBedrock.NextResult = new NoteAnalysisResult("", [], []);
    }

    // Scenario: Analysis fills gaps in note content, extracts tags and action items
    [Fact]
    public async Task PostAnalyse_UpdatesContentTagsAndActions_Returns204()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            "Discussed login bug. We agreed to fix login by Friday. Owner: Alice.",
            ["login", "auth"],
            ["Fix login bug by Friday"]);

        var noteId = await CreateNoteWithTranscriptAsync(
            content: "Discussed login bug.",
            transcript: "We agreed to fix login by Friday. Alice will fix it.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", Json(new { updateContent = true }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var detail = await GetNoteAsync(noteId);
        Assert.Contains("Owner: Alice", detail.GetProperty("content").GetString());
        var tags = detail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("login", tags);
        Assert.Contains("auth", tags);

        var actions = await GetActionsAsync(noteId);
        Assert.Contains(actions, a => a.GetProperty("description").GetString()!.Contains("Fix login bug"));
    }

    // Scenario: Analysis is a no-op when Bedrock returns unchanged content and empty tags/actions
    [Fact]
    public async Task PostAnalyse_NoChanges_Returns204WithNoSideEffects()
    {
        const string content = "Meeting notes.";
        _fakeBedrock.NextResult = new NoteAnalysisResult(content, [], []);

        var noteId = await CreateNoteWithTranscriptAsync(content: content, transcript: "same old stuff");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        Assert.Equal(content, detail.GetProperty("content").GetString());
    }

    // Scenario: Analysis runs on note content when no transcript exists (10-H)
    [Fact]
    public async Task PostAnalyse_ContentButNoTranscript_RunsAnalysis_Returns204()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            "Met with Bob about the login bug.", ["login"], ["Follow up with Bob"]);

        var noteId = await CreateNoteWithContentAsync("Met with Bob about the login bug.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", Json(new { updateContent = false }));

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

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", Json(new { updateContent = false }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    // Scenario: Whitespace-only content with no transcript is treated as nothing to analyse (10-H)
    [Fact]
    public async Task PostAnalyse_WhitespaceContentNoTranscript_Returns422()
    {
        var noteId = await CreateNoteWithContentAsync("   ");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", Json(new { updateContent = false }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    // Scenario: Content is left untouched when the update-content switch is off (10-H)
    [Fact]
    public async Task PostAnalyse_UpdateContentFalse_LeavesContentUnchanged_StillTagsAndActions()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            "COMPLETELY REWRITTEN BY THE MODEL", ["login"], ["Fix the login bug"]);

        var noteId = await CreateNoteWithTranscriptAsync(
            content: "My private notes.", transcript: "Alice will fix login.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", Json(new { updateContent = false }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        Assert.Equal("My private notes.", detail.GetProperty("content").GetString());
        var tags = detail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("login", tags);
        var actions = await GetActionsAsync(noteId);
        Assert.Contains(actions, a => a.GetProperty("description").GetString()!.Contains("Fix the login bug"));
    }

    // Scenario: Content is rewritten only when the update-content switch is on (10-H)
    [Fact]
    public async Task PostAnalyse_UpdateContentTrue_RewritesContent()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            "My private notes. Alice will fix the login bug by Friday.", [], []);

        var noteId = await CreateNoteWithTranscriptAsync(
            content: "My private notes.", transcript: "Alice will fix login by Friday.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", Json(new { updateContent = true }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var detail = await GetNoteAsync(noteId);
        Assert.Contains("by Friday", detail.GetProperty("content").GetString());
    }

    // Scenario: Both note content and transcript are passed to the analysis service (10-H)
    [Fact]
    public async Task PostAnalyse_PassesContentTranscriptAndFlagToService()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("unchanged", [], []);

        var noteId = await CreateNoteWithTranscriptAsync(
            content: "Login bug.", transcript: "Alice will fix it by Friday.");

        await _client.PostAsync($"/notes/{noteId}/analyse", Json(new { updateContent = true }));

        Assert.NotNull(_fakeBedrock.LastRequest);
        Assert.Equal("Login bug.", _fakeBedrock.LastRequest!.ExistingContent);
        Assert.Equal("Alice will fix it by Friday.", _fakeBedrock.LastRequest.TranscriptText);
        Assert.True(_fakeBedrock.LastRequest.AllowContentRewrite);
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
        _fakeBedrock.NextResult = new NoteAnalysisResult("updated", [], []);
        var noteId = await CreateNoteWithTranscriptAsync("original", "transcript");

        var otherClient = _factory.CreateClientAsOtherUser();
        var resp = await otherClient.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // Scenario: Tags already on the note are not duplicated
    [Fact]
    public async Task PostAnalyse_ExistingTagNotDuplicated()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("same content", ["login"], []);

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
        _fakeBedrock.NextResult = new NoteAnalysisResult("same content", [], ["Fix login bug by Friday"]);

        var noteId = await CreateNoteWithTranscriptAsync("same content", "Fix login bug by Friday");
        await _client.PostAsync($"/notes/{noteId}/analyse", null);

        // Second call with the same action item
        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var actions = await GetActionsAsync(noteId);
        Assert.Single(actions, a => a.GetProperty("description").GetString()!.Contains("Fix login bug"));
    }

    // Scenario: Bedrock failure returns 503
    [Fact]
    public async Task PostAnalyse_WhenBedrockThrows_Returns503()
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
