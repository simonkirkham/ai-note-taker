using Api.Services;

namespace Api.Integration;

// Records the jobs the diarize endpoint asks to start, so tests can assert the call happened
// (and the job name encodes the noteId) without hitting Amazon Transcribe.
public sealed class FakeTranscriptionJobStarter : ITranscriptionJobStarter
{
    public readonly List<(string JobName, string AudioKey)> Started = [];

    public Task<string> StartAsync(string jobName, string audioKey, CancellationToken ct = default)
    {
        Started.Add((jobName, audioKey));
        return Task.FromResult(jobName);
    }
}
