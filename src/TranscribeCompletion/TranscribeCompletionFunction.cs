using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.Lambda.Core;
using Amazon.S3;
using Amazon.TranscribeService;
using Api.Services;
using EventStore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace TranscribeCompletion;

// The async batch-diarization completion Lambda: triggered by the EventBridge "Transcribe Job State
// Change" rule (source aws.transcribe). On a COMPLETED job it fetches the result, parses speaker
// turns into "Speaker N: …" text, and appends TranscriptionDiarized — replacing the streamed
// transcript with the diarized one (the projector folds it; reads see TranscriptIsDiarized = true).
// On a FAILED job, or any fetch/parse error, the streamed transcript is left intact and the failure
// is made visible via a metric + log — the note is never blanked. This is the dedicated non-HTTP
// handler the 27-C lesson calls for (no held HTTP request, no Command-Lambda multiplexing).
// Re-analysis on the diarized text is 33-B2, NOT here.
public sealed class TranscribeCompletionFunction
{
    private const string Completed = "COMPLETED";
    private const string Failed = "FAILED";

    private readonly ITranscriptionResultFetcher _fetcher;
    private readonly IDiarizedTranscriptWriter _writer;
    private readonly ITranscribeCompletionMetrics _metrics;
    private readonly ILogger<TranscribeCompletionFunction> _logger;

    public TranscribeCompletionFunction() : this(BuildServices()) { }

    // Test seam: inject an in-memory service graph.
    public TranscribeCompletionFunction(IServiceProvider services)
    {
        _fetcher = services.GetRequiredService<ITranscriptionResultFetcher>();
        _writer = services.GetRequiredService<IDiarizedTranscriptWriter>();
        _metrics = services.GetRequiredService<ITranscribeCompletionMetrics>();
        _logger = services.GetRequiredService<ILogger<TranscribeCompletionFunction>>();
    }

    public async Task Handle(TranscribeJobStateChange evt, ILambdaContext context)
    {
        var jobName = evt.Detail.TranscriptionJobName;
        var status = evt.Detail.TranscriptionJobStatus;
        if (!DiarizationJobNames.TryGetNoteId(jobName, out var noteIdStr))
        {
            // Not one of our diarization jobs (or an unrecognised name) — ignore quietly.
            _logger.LogDebug("transcribe: ignoring job {Job} (status {Status})", jobName, status);
            return;
        }
        var noteId = Guid.Parse(noteIdStr);

        if (status == Failed)
        {
            // Streamed transcript stays the note's transcript — never blanked. Make the failure visible.
            _metrics.BatchFailed();
            _logger.LogWarning("transcribe: batch job FAILED {Job} note {Note} — keeping streamed transcript", jobName, noteId);
            return;
        }
        if (status != Completed)
        {
            _logger.LogDebug("transcribe: job {Job} note {Note} status {Status} — no action", jobName, noteId, status);
            return;
        }

        TranscribeJobResult? result;
        try
        {
            result = await _fetcher.FetchAsync(jobName).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Transient fetch error (Transcribe/S3) — surface it and let EventBridge retry the delivery.
            _metrics.BatchFailed();
            _logger.LogError(ex, "transcribe: fetch failed for {Job} note {Note}", jobName, noteId);
            throw;
        }

        if (result is null)
        {
            // COMPLETED but no transcript URI — anomalous but not a fault to page on (no data lost;
            // the streamed transcript stays). Log only, don't trip the failure alarm.
            _logger.LogWarning("transcribe: no result for COMPLETED job {Job} note {Note}", jobName, noteId);
            return;
        }

        DiarizedTranscript parsed;
        try
        {
            parsed = TranscribeResultParser.Parse(result.ResultJson);
        }
        catch (JsonException ex)
        {
            // Poison result JSON: do NOT throw (would retry the same poison forever) — keep the
            // streamed transcript and make it visible.
            _metrics.BatchFailed();
            _logger.LogError(ex, "transcribe: parse failed for {Job} note {Note} — keeping streamed transcript", jobName, noteId);
            return;
        }

        if (string.IsNullOrWhiteSpace(parsed.Text))
        {
            // A recording of silence (or a very short clip) legitimately diarizes to empty text —
            // a benign success, not a fault. Log only; the streamed transcript stays and the
            // failure alarm is reserved for genuine faults (FAILED job, fetch error, poison JSON).
            _logger.LogInformation("transcribe: empty diarized text for {Job} note {Note} — keeping streamed transcript", jobName, noteId);
            return;
        }

        var appended = await _writer.AppendAsync(noteId, parsed.Text, parsed.SpeakerCount, jobName, result.SourceAudioKey)
            .ConfigureAwait(false);
        if (!appended)
        {
            _logger.LogWarning("transcribe: note {Note} gone/deleted for {Job} — diarized event not appended", noteId, jobName);
            return;
        }
        _metrics.BatchCompleted(result.DurationMs);
        _logger.LogInformation("transcribe: diarized note {Note} from {Job} ({Speakers} speakers, {Ms}ms)",
            noteId, jobName, parsed.SpeakerCount, result.DurationMs);
    }

    private static IServiceProvider BuildServices()
    {
        var services = new ServiceCollection();
        services.AddLogging(b => b.AddJsonConsole());
        services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient());
        services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client());
        services.AddSingleton<IAmazonTranscribeService>(_ => new AmazonTranscribeServiceClient());

        services.AddSingleton<IEventStore>(sp =>
            new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), Env("EVENTS_TABLE_NAME")));
        services.AddSingleton<ITranscriptionResultFetcher>(sp =>
            new TranscribeResultFetcher(sp.GetRequiredService<IAmazonTranscribeService>(), sp.GetRequiredService<IAmazonS3>()));
        services.AddSingleton<IDiarizedTranscriptWriter>(sp => new DiarizedTranscriptWriter(sp.GetRequiredService<IEventStore>()));
        services.AddSingleton<ITranscribeCompletionMetrics, TranscribeCompletionMetrics>();

        return services.BuildServiceProvider();
    }

    private static string Env(string name) =>
        Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException($"{name} is not set.");
}
