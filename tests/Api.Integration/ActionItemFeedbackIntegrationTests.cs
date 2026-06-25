using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Services;
using EventStore.Projections;
using Microsoft.Extensions.DependencyInjection;

namespace Api.Integration;

[Collection("ProjectionRebuild")]
public sealed class ActionItemFeedbackIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly ApiFactory _factory;
    private readonly FakeBedrockAnalysisService _fakeBedrock;
    private const string User = FakeCurrentUser.TestUserId;

    public ActionItemFeedbackIntegrationTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        _fakeBedrock = factory.Services.GetRequiredService<FakeBedrockAnalysisService>();
    }

    // Scenario: A suggested action increments the suggested count for the user
    [Fact]
    public async Task Analyse_SuggestingActions_IncrementsSuggestedCount()
    {
        var before = Sug(await FeedbackAsync(User));

        await AnalyseWithActionsAsync("af-sug-1", "af-sug-2");

        Assert.Equal(before + 2, Sug(await FeedbackAsync(User)));
    }

    // RYW-3c — guards that the AI-suggestion feedback counter is incremented EXACTLY ONCE per
    // suggested action. That counter is an unconditional, NON-idempotent DynamoDB `ADD`, and the
    // projector is now its SOLE writer. Before the RYW migration, prod ran the `ADD` twice per
    // suggestion — once on the inline handler write and once on the async Projector Lambda —
    // double-counting every suggestion. Analysis suggestions ride on the `note#` stream, so that
    // inline write was removed when note# migrated in RYW-2; the double-count closed then (NOT in a
    // separate "analyse" migration — there is no remaining inline write). This test fails (+2) if an
    // inline feedback write is ever re-introduced alongside the projector.
    [Fact]
    public async Task Analyse_SuggestingOneAction_IncrementsSuggestedCountExactlyOnce()
    {
        var before = Sug(await FeedbackAsync(User));

        await AnalyseWithActionsAsync("af-once");

        Assert.Equal(before + 1, Sug(await FeedbackAsync(User)));
    }

    // Scenario: Completing an AI-suggested action increments the completed count
    [Fact]
    public async Task Completing_SuggestedAction_IncrementsCompletedCount()
    {
        var noteId = await AnalyseWithActionsAsync("af-complete-me");
        var actionId = await ActionIdForAsync(noteId, "af-complete-me");
        var before = Comp(await FeedbackAsync(User));

        var resp = await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        resp.EnsureSuccessStatusCode();

        Assert.Equal(before + 1, Comp(await FeedbackAsync(User)));
    }

    // Scenario: Deleting an AI-suggested action increments the deleted count
    [Fact]
    public async Task Deleting_SuggestedAction_IncrementsDeletedCount()
    {
        var noteId = await AnalyseWithActionsAsync("af-delete-me");
        var actionId = await ActionIdForAsync(noteId, "af-delete-me");
        var before = Del(await FeedbackAsync(User));

        var resp = await _client.DeleteAsync($"/notes/{noteId}/actions/{actionId}");
        resp.EnsureSuccessStatusCode();

        Assert.Equal(before + 1, Del(await FeedbackAsync(User)));
    }

    // Scenario: Deleting a manually-added action is not counted
    [Fact]
    public async Task Deleting_ManuallyAddedAction_IsNotCounted()
    {
        var noteId = await CreateNoteAsync();
        var addResp = await _client.PostAsync($"/notes/{noteId}/actions", Json(new { description = "af-manual" }));
        var actionId = (await addResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("actionId").GetString();
        var before = Del(await FeedbackAsync(User));

        await _client.DeleteAsync($"/notes/{noteId}/actions/{actionId}");

        Assert.Equal(before, Del(await FeedbackAsync(User)));
    }

    // Scenario: The projection rebuilds from the event stream with identical counts
    [Fact]
    public async Task Rebuild_ReproducesLiveCounts()
    {
        var noteId = await AnalyseWithActionsAsync("af-rebuild-1", "af-rebuild-2");
        var deleteId = await ActionIdForAsync(noteId, "af-rebuild-1");
        var completeId = await ActionIdForAsync(noteId, "af-rebuild-2");
        await _client.DeleteAsync($"/notes/{noteId}/actions/{deleteId}");
        await _client.PostAsync($"/notes/{noteId}/actions/{completeId}/complete", null);

        var store = _factory.Services.GetRequiredService<IActionItemFeedbackStore>();
        var before = Snapshot(await store.GetAllAsync());

        var rebuild = await _client.PostAsync("/admin/projections/rebuild", null);
        rebuild.EnsureSuccessStatusCode();

        Assert.Equal(before, Snapshot(await store.GetAllAsync()));
    }

    // Scenario: rebuild parity holds for the same item completed then deleted (both counters increment)
    [Fact]
    public async Task Rebuild_SameItemCompletedThenDeleted_ParityHolds()
    {
        var noteId = await AnalyseWithActionsAsync("af-both");
        var actionId = await ActionIdForAsync(noteId, "af-both");
        var beforeComp = Comp(await FeedbackAsync(User));
        var beforeDel = Del(await FeedbackAsync(User));

        await _client.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);
        await _client.DeleteAsync($"/notes/{noteId}/actions/{actionId}");

        Assert.Equal(beforeComp + 1, Comp(await FeedbackAsync(User)));
        Assert.Equal(beforeDel + 1, Del(await FeedbackAsync(User)));

        var store = _factory.Services.GetRequiredService<IActionItemFeedbackStore>();
        var snapshot = Snapshot(await store.GetAllAsync());

        var rebuild = await _client.PostAsync("/admin/projections/rebuild", null);
        rebuild.EnsureSuccessStatusCode();

        Assert.Equal(snapshot, Snapshot(await store.GetAllAsync()));
    }

    // Scenario (10-M): the analyse path stamps the run's prompt version onto the action provenance row,
    // and the stamp survives a projection rebuild (rebuild handler passes PromptVersion through).
    [Fact]
    public async Task Analyse_StampsPromptVersionOnProvenance_AndSurvivesRebuild()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], [], ["af-pv-me"],
            ModelId: "amazon.nova-lite-v1:0", PromptVersion: "analysis@v2");
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "discussion", durationSeconds = 10 }));
        (await _client.PostAsync($"/notes/{noteId}/analyse", null)).EnsureSuccessStatusCode();
        var actionId = await ActionIdForAsync(noteId, "af-pv-me");

        var store = (InMemoryActionItemFeedbackStore)_factory.Services.GetRequiredService<IActionItemFeedbackStore>();
        Assert.Equal("analysis@v2", store.PromptVersionFor(actionId));

        (await _client.PostAsync("/admin/projections/rebuild", null)).EnsureSuccessStatusCode();
        Assert.Equal("analysis@v2", store.PromptVersionFor(actionId));
    }

    private async Task<string> AnalyseWithActionsAsync(params string[] descriptions)
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], [], descriptions);
        var noteId = await CreateNoteAsync();
        await _client.PostAsync($"/notes/{noteId}/transcription",
            Json(new { transcriptText = "discussion", durationSeconds = 10 }));
        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);
        resp.EnsureSuccessStatusCode();
        return noteId;
    }

    private async Task<string> ActionIdForAsync(string noteId, string description)
    {
        var resp = await _client.GetAsync($"/notes/{noteId}/actions");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("actions").EnumerateArray()
            .First(a => a.GetProperty("description").GetString() == description)
            .GetProperty("actionId").GetString()!;
    }

    private async Task<ActionItemFeedbackView?> FeedbackAsync(string userId)
    {
        var store = _factory.Services.GetRequiredService<IActionItemFeedbackStore>();
        return (await store.GetAllAsync()).FirstOrDefault(v => v.UserId == userId);
    }

    private static int Sug(ActionItemFeedbackView? v) => v?.SuggestedCount ?? 0;
    private static int Del(ActionItemFeedbackView? v) => v?.DeletedCount ?? 0;
    private static int Comp(ActionItemFeedbackView? v) => v?.CompletedCount ?? 0;

    private static IReadOnlyList<string> Snapshot(IReadOnlyList<ActionItemFeedbackView> views) =>
        views.Select(v => $"{v.UserId}|{v.SuggestedCount}|{v.DeletedCount}|{v.CompletedCount}")
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
