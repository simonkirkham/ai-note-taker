using Amazon.TranscribeService;
using Amazon.TranscribeService.Model;

namespace Api.Services;

// Starts an Amazon Transcribe batch job with ShowSpeakerLabels over a recording in the recordings
// bucket; the result JSON is written back to the same bucket (7-day lifecycle covers it). en-GB and
// a generous MaxSpeakerLabels match the meeting-recording use case. The streamed transcript stays
// the note's transcript until the diarized event lands — this never blocks.
public sealed class TranscribeBatchJobStarter(IAmazonTranscribeService transcribe, string bucketName)
    : ITranscriptionJobStarter
{
    private const int MaxSpeakers = 10;

    public async Task<string> StartAsync(string jobName, string audioKey, CancellationToken ct = default)
    {
        await transcribe.StartTranscriptionJobAsync(new StartTranscriptionJobRequest
        {
            TranscriptionJobName = jobName,
            LanguageCode = LanguageCode.EnGB,
            MediaFormat = MediaFormat.Wav,
            Media = new Media { MediaFileUri = $"s3://{bucketName}/{audioKey}" },
            OutputBucketName = bucketName,
            OutputKey = $"transcripts/{jobName}.json",
            Settings = new Settings
            {
                ShowSpeakerLabels = true,
                MaxSpeakerLabels = MaxSpeakers
            }
        }, ct).ConfigureAwait(false);
        return jobName;
    }
}
