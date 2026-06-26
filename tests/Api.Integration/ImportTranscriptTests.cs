using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Services;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// Phase 38-A — import a transcript manually. POST /notes/import-transcript creates a note from
// pasted text and runs the SAME analysis pipeline as a recording, reusing the recorded-note events
// minus audio. (Paths are un-prefixed; ApiFactory rewrites them to the default workspace.)
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

    // Scenario 1 + 5: import creates an analysed note via the recorded-note events minus audio.
    [Fact]
    public async Task Import_NonEmptyTranscript_CreatesAnalysedNote_WithRecordedEventSequenceMinusAudio()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult(
            Summary: "The team agreed to ship the login fix on Friday.",
            DiscussionPoints: ["Login fails on Friday"],
            Decisions: ["Ship Friday"],
            NewTags: ["login"],
            NewActionItems: ["Fix login bug by Friday"],
            ModelId: "amazon.nova-lite-v1:0",
            PromptVersion: "analysis@v8");

        var noteId = await ImportAsync("We agreed to fix login by Friday. Alice will own it.");

        var detail = await GetNoteAsync(noteId);
        Assert.Equal("We agreed to fix login by Friday. Alice will own it.",
            detail.GetProperty("transcriptText").GetString());
        Assert.Equal("The team agreed to ship the login fix on Friday.", detail.GetProperty("summary").GetString());
        var tags = detail.GetProperty("tags").EnumerateArray().Select(t => t.GetString()).ToList();
        Assert.Contains("login", tags);
        var actions = await GetActionsAsync(noteId);
        Assert.Contains(actions, a => a.GetProperty("description").GetString()!.Contains("Fix login bug"));

        var events = await ReadStreamAsync(noteId);
        Assert.Single(events, e => e.EventType == nameof(NoteCreated));
        Assert.Single(events, e => e.EventType == nameof(TranscriptionCompleted));
        Assert.Single(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
        // The recorded path minus audio: no recording-upload or diarization events.
        Assert.DoesNotContain(events, e => e.EventType == nameof(RecordingUploaded));
        Assert.DoesNotContain(events, e => e.EventType == nameof(TranscriptionDiarized));
    }

    // Scenario 2: 201 with { noteId } and an X-Consistency-Token at the post-analysis version.
    [Fact]
    public async Task Import_Returns201_WithNoteId_AndPostAnalysisConsistencyToken()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], ["meeting"], []);

        var resp = await _client.PostAsync("/notes/import-transcript",
            Json(new { transcriptText = "Some meeting transcript." }));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var noteId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        Assert.False(string.IsNullOrEmpty(noteId));

        var token = Assert.Single(resp.Headers.GetValues("X-Consistency-Token"));
        Assert.StartsWith($"note#{noteId}@", token);
        // The token version is the FINAL stream version — it covers the analysis appends, not just
        // the transcript (so the first gated read shows the finished, analysed note).
        var version = long.Parse(token.Split('@')[1]);
        var events = await ReadStreamAsync(noteId);
        Assert.Equal(events.Count, version);
        Assert.Contains(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
    }

    // Scenario 3: whitespace-only transcript → 400, no note created.
    [Fact]
    public async Task Import_WhitespaceTranscript_Returns400_NoNoteCreated()
    {
        var resp = await _client.PostAsync("/notes/import-transcript",
            Json(new { transcriptText = "   " }));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        // Nothing was created, so there is no consistency token to surface.
        Assert.False(resp.Headers.Contains("X-Consistency-Token"));
    }

    // An over-long paste (beyond the ~350 KB cap) is a clean 400, not an unhandled 500 at the
    // DynamoDB ~400 KB item limit — and no note is created.
    [Fact]
    public async Task Import_TranscriptOverByteCap_Returns400_NoNoteCreated()
    {
        var huge = new string('a', 360_000); // 360 KB of ASCII > the 350 KB byte cap
        var resp = await _client.PostAsync("/notes/import-transcript",
            Json(new { transcriptText = huge }));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.False(resp.Headers.Contains("X-Consistency-Token"));
    }

    // Scenario 4: Bedrock failure still saves the note (201) with its transcript and no analysis.
    [Fact]
    public async Task Import_WhenBedrockThrows_StillCreatesNote_WithTranscript_NoAnalysis()
    {
        var throwingFactory = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IBedrockAnalysisService>();
            s.AddSingleton<IBedrockAnalysisService, ThrowingBedrockAnalysisService>();
        }));
        var client = throwingFactory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var resp = await client.PostAsync("/notes/import-transcript",
            Json(new { transcriptText = "An external transcript that cannot be analysed right now." }));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var noteId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        var events = await ReadStreamAsync(noteId, throwingFactory);
        Assert.Single(events, e => e.EventType == nameof(TranscriptionCompleted));
        Assert.DoesNotContain(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
    }

    // Scenario 5: an imported note is a first-class note — it shows on the home cards list.
    [Fact]
    public async Task Import_ImportedNote_AppearsInNoteCards()
    {
        _fakeBedrock.NextResult = new NoteAnalysisResult("a summary", [], [], [], []);

        var noteId = await ImportAsync("A standup happened and we synced on progress.");

        var resp = await _client.GetAsync("/notes/cards");
        resp.EnsureSuccessStatusCode();
        var cards = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("cards");
        Assert.Contains(cards.EnumerateArray(), c => c.GetProperty("noteId").GetString() == noteId);
    }

    // Scenario: import requires authentication.
    [Fact]
    public async Task Import_Unauthenticated_Returns401()
    {
        var unauth = _factory.CreateUnauthenticatedClient();
        var resp = await unauth.PostAsync("/notes/import-transcript",
            Json(new { transcriptText = "x" }));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // Acceptance criterion 2: analysis reads the pasted text via transcriptOverride and NEVER the
    // async projection. With a NoteDetail projection that always lags (GetAsync → null), a
    // projection-reading analyse would 422; the override branch still analyses the supplied text.
    [Fact]
    public async Task Import_WhenProjectionLags_StillAnalysesViaOverride()
    {
        var laggingFactory = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<INoteDetailStore>();
            s.AddSingleton<InMemoryNoteDetailStore>();
            s.AddSingleton<INoteDetailStore>(sp =>
                new LaggingNoteDetailStore(sp.GetRequiredService<InMemoryNoteDetailStore>()));
        }));
        var client = laggingFactory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        var bedrock = laggingFactory.Services.GetRequiredService<FakeBedrockAnalysisService>();
        bedrock.NextResult = new NoteAnalysisResult("a summary from the override", [], [], ["imported"], []);

        var resp = await client.PostAsync("/notes/import-transcript",
            Json(new { transcriptText = "pasted transcript content" }));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var noteId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        // Bedrock saw the override text, despite the projection returning null throughout.
        Assert.Equal("pasted transcript content", bedrock.LastRequest!.TranscriptText);
        var events = await ReadStreamAsync(noteId, laggingFactory);
        Assert.Single(events, e => e.EventType == nameof(AnalysisSummaryRecorded));
    }

    private async Task<string> ImportAsync(string transcriptText)
    {
        var resp = await _client.PostAsync("/notes/import-transcript", Json(new { transcriptText }));
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }

    private Task<IReadOnlyList<EventEnvelope>> ReadStreamAsync(string noteId) => ReadStreamAsync(noteId, _factory);

    private static async Task<IReadOnlyList<EventEnvelope>> ReadStreamAsync(string noteId, WebApplicationFactory<Program> factory)
    {
        var store = factory.Services.GetRequiredService<IEventStore>();
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

// Simulates the async projector never having caught up: writes are applied to the inner store, but
// GetAsync always returns null — exactly the prod window where a just-imported note's NoteDetail row
// does not exist yet. Proves AnalyseAsync's transcriptOverride branch never depends on the projection.
internal sealed class LaggingNoteDetailStore(InMemoryNoteDetailStore inner) : INoteDetailStore
{
    public Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default) => inner.UpsertAsync(detail, ct);
    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default) => inner.DeleteAsync(noteId, ct);
    public Task DeleteAllAsync(CancellationToken ct = default) => inner.DeleteAllAsync(ct);
    public Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default) =>
        Task.FromResult<NoteDetailView?>(null);
    public Task<IReadOnlyList<NoteDetailView>> QueryAllAsync(CancellationToken ct = default) => inner.QueryAllAsync(ct);
}
