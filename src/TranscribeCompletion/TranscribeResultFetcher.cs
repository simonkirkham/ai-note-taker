using Amazon.S3;
using Amazon.S3.Model;
using Amazon.TranscribeService;
using Amazon.TranscribeService.Model;

namespace TranscribeCompletion;

public sealed class TranscribeResultFetcher(IAmazonTranscribeService transcribe, IAmazonS3 s3)
    : ITranscriptionResultFetcher
{
    public async Task<TranscribeJobResult?> FetchAsync(string jobName, CancellationToken ct = default)
    {
        var job = (await transcribe.GetTranscriptionJobAsync(
            new GetTranscriptionJobRequest { TranscriptionJobName = jobName }, ct).ConfigureAwait(false))
            .TranscriptionJob;

        var resultUri = job.Transcript?.TranscriptFileUri;
        if (string.IsNullOrEmpty(resultUri)) return null;

        var (resultBucket, resultKey) = ParseS3Uri(resultUri);
        using var obj = await s3.GetObjectAsync(
            new GetObjectRequest { BucketName = resultBucket, Key = resultKey }, ct).ConfigureAwait(false);
        using var reader = new StreamReader(obj.ResponseStream);
        var json = await reader.ReadToEndAsync(ct).ConfigureAwait(false);

        var (_, sourceKey) = ParseS3Uri(job.Media?.MediaFileUri ?? "");
        var duration = job.CompletionTime is { } done && job.CreationTime is { } start
            ? (done - start).TotalMilliseconds
            : 0;
        return new TranscribeJobResult(json, sourceKey, duration);
    }

    // s3://bucket/key… or an https://s3.<region>.amazonaws.com/bucket/key URL (older Transcribe
    // result URIs use the HTTPS form). Returns (bucket, key).
    private static (string Bucket, string Key) ParseS3Uri(string uri)
    {
        if (string.IsNullOrEmpty(uri)) return ("", "");
        if (uri.StartsWith("s3://", StringComparison.Ordinal))
        {
            var rest = uri["s3://".Length..];
            var slash = rest.IndexOf('/');
            return slash < 0 ? (rest, "") : (rest[..slash], rest[(slash + 1)..]);
        }
        var parsed = new Uri(uri);
        var path = parsed.AbsolutePath.TrimStart('/');
        var firstSlash = path.IndexOf('/');
        return firstSlash < 0 ? (path, "") : (path[..firstSlash], path[(firstSlash + 1)..]);
    }
}
