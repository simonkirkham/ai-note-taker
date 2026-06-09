using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

public sealed class SearchNotesTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;
    private readonly FakeBedrockAnalysisService _fakeBedrock;

    public SearchNotesTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        _fakeBedrock = factory.Services.GetRequiredService<FakeBedrockAnalysisService>();
        _fakeBedrock.NextResult = new NoteAnalysisResult("", [], [], [], []);
    }

    // Scenario: Fuzzy match tolerates a typo
    [Fact]
    public async Task Search_FuzzyMatchToleratesTypo()
    {
        var noteId = await CreateNoteWithBodyAsync("This meeting is about planning the roadmap.");

        var ids = await SearchIdsAsync("planing");

        Assert.Contains(noteId, ids);
    }

    // Scenario: Match on the Quick-notes body
    [Fact]
    public async Task Search_MatchesOnBody()
    {
        var noteId = await CreateNoteWithBodyAsync("Notes from the budget review session.");

        var ids = await SearchIdsAsync("budget");

        Assert.Contains(noteId, ids);
    }

    // Scenario: Match on Final-notes text
    [Fact]
    public async Task Search_MatchesOnFinalNotes()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            Summary: "The team agreed a database migration plan.",
            DiscussionPoints: [], Decisions: [], NewTags: [], NewActionItems: []);
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "Some quick notes.");
        await PostTranscriptAsync(noteId, "We talked about moving the database.");
        await _client.PostAsync($"/notes/{noteId}/analyse", null);

        var ids = await SearchIdsAsync("migration");

        Assert.Contains(noteId, ids);
    }

    // Scenario: Match on a tag
    [Fact]
    public async Task Search_MatchesOnTag()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "Unrelated body text.");
        await PostAsync($"/notes/{noteId}/tags", new { tag = "roadmap" });

        var ids = await SearchIdsAsync("roadmap");

        Assert.Contains(noteId, ids);
    }

    // Scenario: Match on action-item text
    [Fact]
    public async Task Search_MatchesOnActionItemText()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "Unrelated body text.");
        await AddActionAsync(noteId, "Email the vendor about pricing");

        var ids = await SearchIdsAsync("vendor");

        Assert.Contains(noteId, ids);
    }

    // Scenario: Transcript text is not searched
    [Fact]
    public async Task Search_DoesNotMatchTranscript()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "Generic body.");
        await PostTranscriptAsync(noteId, "We discussed the quarterly forecast at length.");

        var ids = await SearchIdsAsync("quarterly");

        Assert.DoesNotContain(noteId, ids);
    }

    // Scenario: Results are ranked with title weighted highest
    [Fact]
    public async Task Search_TitleMatchRanksAboveBodyMatch()
    {
        var titleMatch = await CreateNoteAsync();
        await RenameAsync(titleMatch, "Procurement strategy");
        await PutContentAsync(titleMatch, "Generic notes.");

        var bodyMatch = await CreateNoteWithBodyAsync("We need a clear procurement approach.");

        var ids = await SearchIdsAsync("procurement");

        Assert.Contains(titleMatch, ids);
        Assert.Contains(bodyMatch, ids);
        Assert.True(ids.IndexOf(titleMatch) < ids.IndexOf(bodyMatch),
            "title match should rank above body-only match");
    }

    // Scenario: Below-threshold query returns nothing, not everything
    [Fact]
    public async Task Search_BelowThresholdReturnsEmpty()
    {
        await CreateNoteWithBodyAsync("Apples and oranges in the fruit bowl.");
        await CreateNoteWithBodyAsync("The cat sat on the mat.");

        var ids = await SearchIdsAsync("zzzqwxnonsense");

        Assert.Empty(ids);
    }

    // Scenario: Results are scoped to the current user
    [Fact]
    public async Task Search_ScopedToCurrentUser()
    {
        var myNote = await CreateNoteWithBodyAsync("The annual report is overdue.");

        var otherClient = _factory.CreateClientAsOtherUser();
        var otherCreate = await otherClient.PostAsync("/notes", null);
        var otherId = (await otherCreate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        await otherClient.PutAsync($"/notes/{otherId}/content", Json(new { content = "Their secret report." }));

        var ids = await SearchIdsAsync("report");

        Assert.Contains(myNote, ids);
        Assert.DoesNotContain(otherId, ids);
    }

    // Scenario: Deleted notes are excluded
    [Fact]
    public async Task Search_ExcludesDeletedNotes()
    {
        var noteId = await CreateNoteWithBodyAsync("Discussion of the merger contract.");
        await _client.DeleteAsync($"/notes/{noteId}");

        var ids = await SearchIdsAsync("merger");

        Assert.DoesNotContain(noteId, ids);
    }

    // Scenario: A note becomes searchable after an edit (inline projection update)
    [Fact]
    public async Task Search_NoteBecomesSearchableAfterEdit_NoRebuild()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "Please pay the invoice today.");

        var ids = await SearchIdsAsync("invoice");

        Assert.Contains(noteId, ids);
    }

    // Scenario: Blank query is rejected cleanly
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Search_BlankQueryReturnsEmpty200(string query)
    {
        await CreateNoteWithBodyAsync("Some body content here.");

        var resp = await _client.GetAsync($"/notes/search?q={Uri.EscapeDataString(query)}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
    }

    // Scenario: Search requires authentication
    [Fact]
    public async Task Search_Unauthenticated_Returns401()
    {
        var unauth = _factory.CreateUnauthenticatedClient();

        var resp = await unauth.GetAsync("/notes/search?q=anything");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // Acceptance: response carries noteId, title, snippet, score, matchedField
    [Fact]
    public async Task Search_ResultIncludesContract()
    {
        var noteId = await CreateNoteAsync();
        await RenameAsync(noteId, "Budget planning");
        await PutContentAsync(noteId, "We must finalise the budget for Q3.");

        var resp = await _client.GetAsync("/notes/search?q=budget");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var match = body.GetProperty("items").EnumerateArray()
            .First(i => i.GetProperty("noteId").GetString() == noteId);

        Assert.Equal("Budget planning", match.GetProperty("title").GetString());
        Assert.True(match.TryGetProperty("snippet", out _));
        Assert.True(match.TryGetProperty("score", out var score));
        Assert.True(score.GetDouble() > 0);
        var matchedField = match.GetProperty("matchedField").GetString();
        Assert.Contains(matchedField, new[] { "title", "tag", "notes" });
    }

    // Scenario (22-C): Exact match returns the matched term
    [Fact]
    public async Task Search_MatchedTerms_ExactBodyMatch()
    {
        var noteId = await CreateNoteWithBodyAsync("Notes from the budget review session.");

        var terms = await MatchedTermsAsync("budget", noteId);

        Assert.Contains("budget", terms, StringComparer.OrdinalIgnoreCase);
    }

    // Scenario (22-C): Fuzzy/typo match returns the word that actually matched
    [Fact]
    public async Task Search_MatchedTerms_FuzzyReturnsActualWord()
    {
        var noteId = await CreateNoteWithBodyAsync("This meeting is about planning the roadmap.");

        var terms = await MatchedTermsAsync("planing", noteId);

        Assert.Contains("planning", terms, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("planing", terms, StringComparer.OrdinalIgnoreCase);
    }

    // Scenario (22-C): Title match returns the matched title word
    [Fact]
    public async Task Search_MatchedTerms_TitleMatch()
    {
        var noteId = await CreateNoteAsync();
        await RenameAsync(noteId, "Procurement strategy");
        await PutContentAsync(noteId, "Generic notes.");

        var item = await SearchItemAsync("procurement", noteId);

        Assert.Equal("title", item.GetProperty("matchedField").GetString());
        var terms = TermsOf(item);
        Assert.Contains("Procurement", terms, StringComparer.OrdinalIgnoreCase);
    }

    // Scenario (22-C): Tag match returns the matched tag as the term
    [Fact]
    public async Task Search_MatchedTerms_TagMatch()
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, "Unrelated body text.");
        await PostAsync($"/notes/{noteId}/tags", new { tag = "roadmap" });

        var item = await SearchItemAsync("roadmap", noteId);

        Assert.Equal("tag", item.GetProperty("matchedField").GetString());
        Assert.Contains("roadmap", TermsOf(item), StringComparer.OrdinalIgnoreCase);
    }

    // Scenario (22-C): Snippet contains the matched term for a fuzzy match
    [Fact]
    public async Task Search_Snippet_ContainsMatchedTermForFuzzy()
    {
        var lead = new string('x', 200);
        var noteId = await CreateNoteWithBodyAsync($"{lead} budget planning session at the end.");

        var item = await SearchItemAsync("planing", noteId);

        var snippet = item.GetProperty("snippet").GetString()!;
        var terms = TermsOf(item);
        Assert.NotEmpty(terms);
        Assert.Contains(terms[0], snippet, StringComparison.OrdinalIgnoreCase);
    }

    private async Task<JsonElement> SearchItemAsync(string query, string noteId)
    {
        var resp = await _client.GetAsync($"/notes/search?q={Uri.EscapeDataString(query)}");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .First(i => i.GetProperty("noteId").GetString() == noteId);
    }

    private async Task<List<string>> MatchedTermsAsync(string query, string noteId)
    {
        var item = await SearchItemAsync(query, noteId);
        return TermsOf(item);
    }

    private static List<string> TermsOf(JsonElement item) =>
        item.GetProperty("matchedTerms").EnumerateArray().Select(t => t.GetString()!).ToList();

    // Scenario: Rebuild backfills the searchable model
    [Fact]
    public async Task Search_RebuildBackfillsSearchableModel()
    {
        var noteId = await CreateNoteWithBodyAsync("Quarterly planning offsite logistics.");

        var store = _factory.Services.GetRequiredService<EventStore.Projections.INoteSearchViewStore>();
        await store.DeleteAllAsync();

        await _client.PostAsync("/admin/projections/rebuild", null);

        var ids = await SearchIdsAsync("logistics");

        Assert.Contains(noteId, ids);
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private async Task<string> CreateNoteWithBodyAsync(string body)
    {
        var noteId = await CreateNoteAsync();
        await PutContentAsync(noteId, body);
        return noteId;
    }

    private Task PutContentAsync(string noteId, string content) =>
        _client.PutAsync($"/notes/{noteId}/content", Json(new { content }));

    private Task RenameAsync(string noteId, string title) =>
        _client.PatchAsync($"/notes/{noteId}/title", Json(new { title }));

    private Task PostTranscriptAsync(string noteId, string transcript) =>
        _client.PostAsync($"/notes/{noteId}/transcription", Json(new { transcriptText = transcript, durationSeconds = 30 }));

    private Task PostAsync(string url, object body) =>
        _client.PostAsync(url, Json(body));

    private async Task<string> AddActionAsync(string noteId, string description)
    {
        var resp = await _client.PostAsync($"/notes/{noteId}/actions", Json(new { description }));
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("actionId").GetString()!;
    }

    private async Task<List<string>> SearchIdsAsync(string query)
    {
        var resp = await _client.GetAsync($"/notes/search?q={Uri.EscapeDataString(query)}");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("noteId").GetString()!)
            .ToList();
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
}
