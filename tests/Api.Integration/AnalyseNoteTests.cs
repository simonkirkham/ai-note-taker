using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

public sealed class AnalyseNoteTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();
    private readonly FakeBedrockAnalysisService _fakeBedrock =
        factory.Services.GetRequiredService<FakeBedrockAnalysisService>();

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

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

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

    // Scenario: Analysis requires a transcript to exist
    [Fact]
    public async Task PostAnalyse_NoTranscript_Returns422()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    // Scenario: Analysis requires authentication
    [Fact]
    public async Task PostAnalyse_Unauthenticated_Returns401()
    {
        var unauthClient = factory.CreateUnauthenticatedClient();

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

        var otherClient = factory.CreateClientAsOtherUser();
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
