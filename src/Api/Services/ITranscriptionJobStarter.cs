namespace Api.Services;

// Starts an Amazon Transcribe batch job over an uploaded recording. Abstracted so the diarize
// endpoint stays a thin HTTP handler and Api.Integration can fake the AWS call. The completion
// of the job is async (EventBridge → TranscribeCompletion Lambda), so this only kicks it off.
public interface ITranscriptionJobStarter
{
    // jobName encodes the noteId (see DiarizationJobNames); audioKey is the recordings/{noteId}/…
    // S3 object to diarize. Returns the started job name.
    Task<string> StartAsync(string jobName, string audioKey, CancellationToken ct = default);
}
