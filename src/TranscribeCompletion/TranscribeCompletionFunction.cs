using System.Text.Json;
using Amazon.BedrockRuntime;
using Amazon.DynamoDBv2;
using Amazon.Lambda.Core;
using Amazon.S3;
using Amazon.TranscribeService;
using Api.Auth;
using Api.CommandHandlers;
using Api.Observability;
using Api.Services;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
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
// 33-B2: when the job name carries the analyse flag (`-a`, the frontend's auto-analyse toggle), the
// handler re-analyses the note exactly once — on the diarized transcript when the job COMPLETES, or
// on the streamed transcript when it FAILS (the frontend deferred the on-Stop analyse). Re-analysis
// is best-effort and runs AFTER the transcript is persisted, so a Bedrock failure never blanks it.
public sealed class TranscribeCompletionFunction
{
    private const string Completed = "COMPLETED";
    private const string Failed = "FAILED";

    private readonly ITranscriptionResultFetcher _fetcher;
    private readonly IDiarizedTranscriptWriter _writer;
    private readonly ITranscribeCompletionMetrics _metrics;
    private readonly IEventStore _events;
    private readonly INoteAnalysisService _analysis;
    private readonly ILogger<TranscribeCompletionFunction> _logger;

    public TranscribeCompletionFunction() : this(BuildServices()) { }

    // Test seam: inject an in-memory service graph.
    public TranscribeCompletionFunction(IServiceProvider services)
    {
        _fetcher = services.GetRequiredService<ITranscriptionResultFetcher>();
        _writer = services.GetRequiredService<IDiarizedTranscriptWriter>();
        _metrics = services.GetRequiredService<ITranscribeCompletionMetrics>();
        _events = services.GetRequiredService<IEventStore>();
        _analysis = services.GetRequiredService<INoteAnalysisService>();
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
            // Fallback (33-B2): the frontend deferred the on-Stop auto-analyse expecting the server to
            // run it. The diarized text never landed, so analyse the streamed transcript — the note is
            // still analysed exactly once. Only when the analyse flag is set (auto-analyse was ON).
            if (DiarizationJobNames.ShouldAnalyse(jobName))
                await MaybeAnalyseAsync(noteId, transcriptOverride: null).ConfigureAwait(false);
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

        // Re-analyse on the diarized text (33-B2) — the projection still lags the event just appended,
        // so pass the parsed text directly rather than letting the service re-read a stale transcript.
        if (DiarizationJobNames.ShouldAnalyse(jobName))
            await MaybeAnalyseAsync(noteId, transcriptOverride: parsed.Text).ConfigureAwait(false);
    }

    // Best-effort re-analysis on the winning transcript. Owner/workspace are read from the note's
    // first event (no HTTP scope). Runs AFTER the transcript is persisted and never throws — a
    // Bedrock failure is AnalysisFailed-metered inside the service; anything else is logged and
    // swallowed so the handler still succeeds (the diarized transcript stays).
    private async Task MaybeAnalyseAsync(Guid noteId, string? transcriptOverride)
    {
        try
        {
            var history = await _events.ReadAsync(new NoteId(noteId).ToStreamId()).ConfigureAwait(false);
            if (history.Count == 0 || history[0].Metadata.UserId is not { } userId)
            {
                _logger.LogWarning("transcribe: cannot re-analyse note {Note} — owner unknown", noteId);
                return;
            }
            var outcome = await _analysis.AnalyseAsync(new NoteId(noteId), userId,
                history[0].Metadata.WorkspaceId, userName: "", transcriptOverride).ConfigureAwait(false);
            _logger.LogInformation("transcribe: re-analysed note {Note} → {Outcome}", noteId, outcome);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "transcribe: re-analysis failed for note {Note} (transcript already updated)", noteId);
        }
    }

    private static IServiceProvider BuildServices()
    {
        var services = new ServiceCollection();
        services.AddLogging(b => b.AddJsonConsole());
        services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient());
        services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client());
        services.AddSingleton<IAmazonTranscribeService>(_ => new AmazonTranscribeServiceClient());

        services.AddSingleton<IAmazonBedrockRuntime>(_ => new AmazonBedrockRuntimeClient());

        services.AddSingleton<IEventStore>(sp =>
            new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), Env("EVENTS_TABLE_NAME")));
        services.AddSingleton<ITranscriptionResultFetcher>(sp =>
            new TranscribeResultFetcher(sp.GetRequiredService<IAmazonTranscribeService>(), sp.GetRequiredService<IAmazonS3>()));
        services.AddSingleton<IDiarizedTranscriptWriter>(sp => new DiarizedTranscriptWriter(sp.GetRequiredService<IEventStore>()));
        services.AddSingleton<ITranscribeCompletionMetrics, TranscribeCompletionMetrics>();

        // 33-B2: the analysis re-run graph. The command handlers persist via their identity-explicit
        // overloads, so ICurrentUser/ICurrentWorkspace are never read — registered as throwing stubs
        // to fail loud if some path ever resolves them. Read models are read-only inputs (warm in the
        // projection; the hot diarized transcript is passed in, not read).
        services.AddSingleton<IDomainMetrics, PowertoolsDomainMetrics>();
        services.AddSingleton<ICurrentUser, UnavailableCurrentUser>();
        services.AddSingleton<ICurrentWorkspace, UnavailableCurrentWorkspace>();
        services.AddSingleton<INoteDetailStore>(sp => new DynamoDbNoteDetailStore(sp.GetRequiredService<IAmazonDynamoDB>(), Env("PROJ_NOTEDETAIL_TABLE_NAME")));
        services.AddSingleton<INoteActionsStore>(sp => new DynamoDbNoteActionsStore(sp.GetRequiredService<IAmazonDynamoDB>(), Env("PROJ_NOTEACTIONS_TABLE_NAME")));
        services.AddSingleton<IBedrockAnalysisService>(sp =>
            new BedrockAnalysisService(sp.GetRequiredService<IAmazonBedrockRuntime>(),
                sp.GetRequiredService<ILogger<BedrockAnalysisService>>(), PromptCatalog.Current, Env("BEDROCK_MODEL_ID")));
        services.AddSingleton<INoteCommandHandler>(sp => new NoteCommandHandler(
            sp.GetRequiredService<IEventStore>(), sp.GetRequiredService<ICurrentUser>(),
            sp.GetRequiredService<ICurrentWorkspace>(), sp.GetRequiredService<IDomainMetrics>(),
            sp.GetRequiredService<ILogger<NoteCommandHandler>>()));
        services.AddSingleton<IActionItemCommandHandler>(sp => new ActionItemCommandHandler(
            sp.GetRequiredService<IEventStore>(), sp.GetRequiredService<ICurrentUser>(),
            sp.GetRequiredService<IDomainMetrics>(), sp.GetRequiredService<ILogger<ActionItemCommandHandler>>()));
        services.AddSingleton<INoteAnalysisService>(sp => new NoteAnalysisService(
            sp.GetRequiredService<INoteCommandHandler>(), sp.GetRequiredService<IActionItemCommandHandler>(),
            sp.GetRequiredService<INoteDetailStore>(), sp.GetRequiredService<INoteActionsStore>(),
            sp.GetRequiredService<IBedrockAnalysisService>(), sp.GetRequiredService<IDomainMetrics>(),
            sp.GetRequiredService<ILogger<NoteAnalysisService>>()));

        return services.BuildServiceProvider();
    }

    private static string Env(string name) =>
        Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException($"{name} is not set.");

    private sealed class UnavailableCurrentUser : ICurrentUser
    {
        private const string Msg = "ICurrentUser is unavailable in the TranscribeCompletion Lambda — analysis persists via the identity-explicit command-handler overloads.";
        public string UserId => throw new InvalidOperationException(Msg);
        public string Name => throw new InvalidOperationException(Msg);
    }

    private sealed class UnavailableCurrentWorkspace : ICurrentWorkspace
    {
        public string WorkspaceId => throw new InvalidOperationException(
            "ICurrentWorkspace is unavailable in the TranscribeCompletion Lambda — workspace is passed explicitly.");
    }
}
