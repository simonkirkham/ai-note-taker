using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Services;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

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
