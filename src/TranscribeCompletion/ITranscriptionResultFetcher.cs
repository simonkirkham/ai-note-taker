namespace TranscribeCompletion;

public sealed record TranscribeJobResult(string ResultJson, string SourceAudioKey, double DurationMs);

// Fetches a completed Transcribe batch job's result: GetTranscriptionJob → read the result JSON
// from S3 → return it plus the source media key and the job's wall-clock duration. Abstracted so
// the completion handler stays testable without hitting AWS.
public interface ITranscriptionResultFetcher
{
    Task<TranscribeJobResult?> FetchAsync(string jobName, CancellationToken ct = default);
}
