using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Services;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

[Collection("ProjectionRebuild")]
public sealed class TagFeedbackIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly ApiFactory _factory;
    private readonly FakeBedrockAnalysisService _fakeBedrock;

    public TagFeedbackIntegrationTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        _fakeBedrock = factory.Services.GetRequiredService<FakeBedrockAnalysisService>();
    }

    // Scenario: A suggested tag increments the suggested count for the user
    [Fact]
    public async Task Analyse_SuggestingTags_IncrementsSuggestedCount()
    {
        await AnalyseWithTagsAsync("tf-suggest-a", "tf-suggest-b");

        var feedback = await FeedbackAsync(FakeCurrentUser.TestUserId, "tf-suggest-a");
        Assert.NotNull(feedback);
        Assert.Equal(1, feedback!.SuggestedCount);
        Assert.Equal(0, feedback.RejectedCount);
    }

    // Scenario: Removing a suggested tag increments the rejected count
    [Fact]
    public async Task Untagging_SuggestedTag_IncrementsRejectedCount()
    {
        var noteId = await AnalyseWithTagsAsync("tf-reject");

        await _client.DeleteAsync($"/notes/{noteId}/tags/tf-reject");

        var feedback = await FeedbackAsync(FakeCurrentUser.TestUserId, "tf-reject");
        Assert.NotNull(feedback);
        Assert.Equal(1, feedback!.SuggestedCount);
        Assert.Equal(1, feedback.RejectedCount);
    }

    // Scenario: Removing a manually-added tag is not a rejection
    [Fact]
    public async Task Untagging_ManuallyAddedTag_IsNotARejection()
    {
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/tags", Json(new { tag = "tf-manual" }));

        await _client.DeleteAsync($"/notes/{noteId}/tags/tf-manual");

        var feedback = await FeedbackAsync(FakeCurrentUser.TestUserId, "tf-manual");
        Assert.Null(feedback);
    }

    // Scenario: Deleting a note retains the suggested/rejected counts
    [Fact]
    public async Task DeletingNote_RetainsCounts()
    {
        var noteId = await AnalyseWithTagsAsync("tf-delete");

        await _client.DeleteAsync($"/notes/{noteId}");

        var feedback = await FeedbackAsync(FakeCurrentUser.TestUserId, "tf-delete");
        Assert.NotNull(feedback);
        Assert.Equal(1, feedback!.SuggestedCount);
    }

    // Scenario (CHANGE-17): a mixed-case AI suggestion and a lowercase removal must record a
    // rejection LIVE — not only on rebuild — so the live path matches the (normalised) rebuild.
    [Fact]
    public async Task MixedCaseSuggestion_LowercaseRemoval_RecordsRejection_LiveAndRebuild()
    {
        var noteId = await AnalyseWithTagsAsync("Tf-Mixed");
        await _client.DeleteAsync($"/notes/{noteId}/tags/tf-mixed");

        var live = await FeedbackAsync(FakeCurrentUser.TestUserId, "tf-mixed");
        Assert.NotNull(live);
        Assert.Equal(1, live!.SuggestedCount);
        Assert.Equal(1, live.RejectedCount);

        (await _client.PostAsync("/admin/projections/rebuild", null)).EnsureSuccessStatusCode();

        var rebuilt = await FeedbackAsync(FakeCurrentUser.TestUserId, "tf-mixed");
        Assert.NotNull(rebuilt);
        Assert.Equal(1, rebuilt!.SuggestedCount);
        Assert.Equal(1, rebuilt.RejectedCount);
    }

    // Scenario: The projection rebuilds from the event stream with identical counts
    [Fact]
    public async Task Rebuild_ReproducesLiveCounts()
    {
        var noteId = await AnalyseWithTagsAsync("tf-rebuild-x", "tf-rebuild-y");
        await _client.DeleteAsync($"/notes/{noteId}/tags/tf-rebuild-x");

        var store = _factory.Services.GetRequiredService<ITagFeedbackStore>();
        var before = Snapshot(await store.GetAllAsync());

        var rebuild = await _client.PostAsync("/admin/projections/rebuild", null);
        rebuild.EnsureSuccessStatusCode();

        var after = Snapshot(await store.GetAllAsync());
        Assert.Equal(before, after);
    }

    // Scenario (10-M): the analyse path stamps the run's prompt version onto the tag provenance row,
    // and the stamp survives a projection rebuild (rebuild handler passes PromptVersion through).
    [Fact]
    public async Task Analyse_StampsPromptVersionOnProvenance_AndSurvivesRebuild()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], ["tf-pv"], [],
            ModelId: "amazon.nova-lite-v1:0", PromptVersion: "analysis@v2");
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "discussion", durationSeconds = 10 }));
        (await _client.PostAsync($"/notes/{noteId}/analyse", null)).EnsureSuccessStatusCode();

        var store = (InMemoryTagFeedbackStore)_factory.Services.GetRequiredService<ITagFeedbackStore>();
        var noteKey = Guid.Parse(noteId).ToString("N");
        Assert.Equal("analysis@v2", store.PromptVersionFor(noteKey, "tf-pv"));

        (await _client.PostAsync("/admin/projections/rebuild", null)).EnsureSuccessStatusCode();
        Assert.Equal("analysis@v2", store.PromptVersionFor(noteKey, "tf-pv"));
    }

    private async Task<string> AnalyseWithTagsAsync(params string[] tags)
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], tags, []);
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "discussion", durationSeconds = 10 }));
        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);
        resp.EnsureSuccessStatusCode();
        return noteId;
    }

    private async Task<TagFeedbackView?> FeedbackAsync(string userId, string tag)
    {
        var store = _factory.Services.GetRequiredService<ITagFeedbackStore>();
        var all = await store.GetAllAsync();
        return all.FirstOrDefault(v => v.UserId == userId && v.Tag == tag);
    }

    private static IReadOnlyList<string> Snapshot(IReadOnlyList<TagFeedbackView> views) =>
        views.Select(v => $"{v.UserId}|{v.Tag}|{v.SuggestedCount}|{v.RejectedCount}")
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToList();

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
}
