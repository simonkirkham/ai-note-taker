using System.Text.Json;
using Api.Services;
using Domain;
using Domain.Notes;
using EventStore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using TranscribeCompletion;
using Xunit;

namespace Api.Integration;

// Unit-level coverage of the async batch-diarization completion handler (it is non-HTTP). Seeds a
// note's event stream, runs the handler against a fake Transcribe result, and asserts the streamed
// transcript is replaced by the diarized one — or left intact on FAILED / empty / poison results.
public sealed class TranscribeCompletionFunctionTests
{
    private const string UserId = "user-1";
    private const string WorkspaceId = "ws-1";

    private readonly InMemoryEventStore _events = new();
    private readonly FakeResultFetcher _fetcher = new();
    private readonly CountingMetrics _metrics = new();
    private readonly FakeNoteAnalysisService _analysis = new();

    private TranscribeCompletionFunction NewFunction()
    {
        var services = new ServiceCollection();
        services.AddSingleton<ITranscriptionResultFetcher>(_fetcher);
        services.AddSingleton<IDiarizedTranscriptWriter>(new DiarizedTranscriptWriter(_events));
        services.AddSingleton<ITranscribeCompletionMetrics>(_metrics);
        services.AddSingleton<EventStore.IEventStore>(_events);
        services.AddSingleton<INoteAnalysisService>(_analysis);
        services.AddSingleton<Microsoft.Extensions.Logging.ILogger<TranscribeCompletionFunction>>(NullLogger<TranscribeCompletionFunction>.Instance);
        return new TranscribeCompletionFunction(services.BuildServiceProvider());
    }

    // Job name with the 33-B2 analyse flag (default off → no re-analysis, isolating transcript behaviour).
    private static string Job(NoteId noteId, bool analyse = false) => DiarizationJobNames.For(noteId.ToString(), analyse);

    private async Task<NoteId> SeedStreamedNoteAsync()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await AppendAsync(noteId.ToStreamId(),
            new NoteCreated(noteId),
            new TranscriptionCompleted(noteId, "streamed transcript", 42));
        return noteId;
    }

    private static TranscribeJobStateChange Event(string jobName, string status) =>
        new() { Detail = new TranscribeJobDetail { TranscriptionJobName = jobName, TranscriptionJobStatus = status } };

    [Fact]
    public async Task Completed_AppendsDiarizedTranscript_ReplacingStreamed()
    {
        var noteId = await SeedStreamedNoteAsync();
        var job = Job(noteId);
        _fetcher.Result = new TranscribeJobResult(TwoSpeakerJson, $"recordings/{noteId}/take.wav", 1500);

        await NewFunction().Handle(Event(job, "COMPLETED"), null!);

        var transcript = await DiarizedTranscriptOf(noteId);
        Assert.Equal("Speaker 1: Hello there.\nSpeaker 2: Hi", transcript);
        Assert.Equal(1, _metrics.Completed);
        Assert.Equal(0, _metrics.Failed);
    }

    [Fact]
    public async Task Failed_KeepsStreamedTranscript_AndRecordsFailure()
    {
        var noteId = await SeedStreamedNoteAsync();
        var job = Job(noteId);

        await NewFunction().Handle(Event(job, "FAILED"), null!);

        Assert.Empty(await DiarizedEnvelopes(noteId)); // no diarized event appended
        Assert.Equal(1, _metrics.Failed);
        Assert.Equal(0, _metrics.Completed);
    }

    [Fact]
    public async Task Completed_EmptyDiarizedText_KeepsStreamedTranscript_WithoutFailingAlarm()
    {
        var noteId = await SeedStreamedNoteAsync();
        var job = Job(noteId);
        _fetcher.Result = new TranscribeJobResult("""{ "results": { "items": [] } }""", $"recordings/{noteId}/take.wav", 100);

        await NewFunction().Handle(Event(job, "COMPLETED"), null!);

        // Silence/short clip → empty text is a benign success: no event appended, streamed
        // transcript stays, and the failure alarm is NOT tripped (reserved for genuine faults).
        Assert.Empty(await DiarizedEnvelopes(noteId));
        Assert.Equal(0, _metrics.Failed);
        Assert.Equal(0, _metrics.Completed);
    }

    [Fact]
    public async Task Completed_PoisonResultJson_DoesNotThrow_KeepsStreamedTranscript()
    {
        var noteId = await SeedStreamedNoteAsync();
        var job = Job(noteId);
        _fetcher.Result = new TranscribeJobResult("not json at all", $"recordings/{noteId}/take.wav", 100);

        var ex = await Record.ExceptionAsync(() => NewFunction().Handle(Event(job, "COMPLETED"), null!));

        Assert.Null(ex); // poison must not retry forever
        Assert.Empty(await DiarizedEnvelopes(noteId));
        Assert.Equal(1, _metrics.Failed);
    }

    [Fact]
    public async Task UnrecognisedJobName_IsIgnored()
    {
        var ex = await Record.ExceptionAsync(() =>
            NewFunction().Handle(Event("some-other-job", "COMPLETED"), null!));

        Assert.Null(ex);
        Assert.Equal(0, _metrics.Completed);
        Assert.Equal(0, _metrics.Failed);
    }

    // ── 33-B2: re-analysis on the winning transcript ──────────────────────────────
    [Fact]
    public async Task Completed_WithAnalyseFlag_AnalysesOnDiarizedText()
    {
        var noteId = await SeedStreamedNoteAsync();
        var job = Job(noteId, analyse: true);
        _fetcher.Result = new TranscribeJobResult(TwoSpeakerJson, $"recordings/{noteId}/take.wav", 1500);

        await NewFunction().Handle(Event(job, "COMPLETED"), null!);

        var call = Assert.Single(_analysis.Calls);
        Assert.Equal(noteId.ToString(), call.NoteId);
        Assert.Equal(UserId, call.UserId);
        Assert.Equal(WorkspaceId, call.WorkspaceId);
        Assert.Equal("Speaker 1: Hello there.\nSpeaker 2: Hi", call.TranscriptOverride); // the diarized text, not stale projection
    }

    [Fact]
    public async Task Failed_WithAnalyseFlag_AnalysesOnStreamedTranscript_AsFallback()
    {
        var noteId = await SeedStreamedNoteAsync();
        var job = Job(noteId, analyse: true);

        await NewFunction().Handle(Event(job, "FAILED"), null!);

        // No diarized event (job failed), but the deferred analyse still runs — on the streamed
        // transcript (null override → the service reads the stored transcript). Analysed exactly once.
        Assert.Empty(await DiarizedEnvelopes(noteId));
        var call = Assert.Single(_analysis.Calls);
        Assert.Null(call.TranscriptOverride);
        Assert.Equal(UserId, call.UserId);
    }

    [Fact]
    public async Task Completed_WithoutAnalyseFlag_DoesNotAnalyse()
    {
        var noteId = await SeedStreamedNoteAsync();
        var job = Job(noteId, analyse: false); // auto-analyse was OFF — diarize only
        _fetcher.Result = new TranscribeJobResult(TwoSpeakerJson, $"recordings/{noteId}/take.wav", 1500);

        await NewFunction().Handle(Event(job, "COMPLETED"), null!);

        Assert.Single(await DiarizedEnvelopes(noteId)); // transcript still diarized
        Assert.Empty(_analysis.Calls);                  // but NOT analysed
    }

    [Fact]
    public async Task Completed_AnalysisThrows_DiarizedTranscriptStillPersisted()
    {
        var noteId = await SeedStreamedNoteAsync();
        var job = Job(noteId, analyse: true);
        _fetcher.Result = new TranscribeJobResult(TwoSpeakerJson, $"recordings/{noteId}/take.wav", 1500);
        _analysis.Throw = true;

        var ex = await Record.ExceptionAsync(() => NewFunction().Handle(Event(job, "COMPLETED"), null!));

        Assert.Null(ex); // re-analysis is best-effort — never rolls back the transcript
        Assert.Single(await DiarizedEnvelopes(noteId));
        Assert.Equal(1, _metrics.Completed);
    }

    private async Task<string> DiarizedTranscriptOf(NoteId noteId)
    {
        var env = Assert.Single(await DiarizedEnvelopes(noteId));
        return JsonSerializer.Deserialize<TranscriptionDiarized>(env.Payload)!.Text;
    }

    private async Task<List<EventEnvelope>> DiarizedEnvelopes(NoteId noteId) =>
        (await _events.ReadAsync(noteId.ToStreamId()))
        .Where(e => e.EventType == nameof(TranscriptionDiarized)).ToList();

    private async Task AppendAsync(string streamId, params IDomainEvent[] events)
    {
        var existing = await _events.ReadAsync(streamId);
        var envelopes = events.Select(e => new EventEnvelope(
            streamId, 0, e.GetType().Name, 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(e, e.GetType()),
            new EventMetadata(Guid.NewGuid(), UserId, null, null, WorkspaceId))).ToList();
        await _events.AppendAsync(streamId, existing.Count, envelopes);
    }

    private const string TwoSpeakerJson = """
    {
      "results": {
        "speaker_labels": {
          "speakers": 2,
          "segments": [
            { "items": [ { "start_time": "0.0", "speaker_label": "spk_0" }, { "start_time": "0.5", "speaker_label": "spk_0" } ] },
            { "items": [ { "start_time": "1.0", "speaker_label": "spk_1" } ] }
          ]
        },
        "items": [
          { "type": "pronunciation", "start_time": "0.0", "alternatives": [ { "content": "Hello" } ] },
          { "type": "pronunciation", "start_time": "0.5", "alternatives": [ { "content": "there" } ] },
          { "type": "punctuation", "alternatives": [ { "content": "." } ] },
          { "type": "pronunciation", "start_time": "1.0", "alternatives": [ { "content": "Hi" } ] }
        ]
      }
    }
    """;

    private sealed class FakeResultFetcher : ITranscriptionResultFetcher
    {
        public TranscribeJobResult? Result;
        public Task<TranscribeJobResult?> FetchAsync(string jobName, CancellationToken ct = default) =>
            Task.FromResult(Result);
    }

    private sealed class CountingMetrics : ITranscribeCompletionMetrics
    {
        public int Completed;
        public int Failed;
        public void BatchCompleted(double durationMs) => Completed++;
        public void BatchFailed() => Failed++;
    }

    private sealed class FakeNoteAnalysisService : INoteAnalysisService
    {
        public readonly List<(string NoteId, string UserId, string? WorkspaceId, string? TranscriptOverride)> Calls = [];
        public bool Throw;

        public Task<AnalysisOutcome> AnalyseAsync(NoteId noteId, string userId, string? workspaceId,
            string userName, string? transcriptOverride, CancellationToken ct = default)
        {
            if (Throw) throw new InvalidOperationException("analysis boom");
            Calls.Add((noteId.ToString(), userId, workspaceId, transcriptOverride));
            return Task.FromResult(AnalysisOutcome.Analysed);
        }
    }
}
