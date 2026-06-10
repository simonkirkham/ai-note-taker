using Amazon.S3;
using Amazon.S3.Model;

namespace Api.Services;

public sealed class S3NoteImageStore(IAmazonS3 s3, string bucketName) : INoteImageStore
{
    static readonly TimeSpan UploadTtl = TimeSpan.FromMinutes(5);
    static readonly TimeSpan DownloadTtl = TimeSpan.FromMinutes(15);

    public string PresignUpload(string key, string contentType) =>
        s3.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = bucketName,
            Key = key,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.Add(UploadTtl),
            ContentType = contentType
        });

    public string PresignDownload(string key) =>
        s3.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = bucketName,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.Add(DownloadTtl)
        });

    public async Task PurgeNoteAsync(string noteId, CancellationToken ct = default)
    {
        var prefix = NoteImageKeys.Prefix(noteId);
        string? continuationToken = null;
        do
        {
            var listed = await s3.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = bucketName,
                Prefix = prefix,
                ContinuationToken = continuationToken
            }, ct);

            var objects = listed.S3Objects;
            if (objects is { Count: > 0 })
            {
                await s3.DeleteObjectsAsync(new DeleteObjectsRequest
                {
                    BucketName = bucketName,
                    Objects = objects.Select(o => new KeyVersion { Key = o.Key }).ToList()
                }, ct);
            }

            continuationToken = listed.IsTruncated == true ? listed.NextContinuationToken : null;
        }
        while (continuationToken is not null);
    }
}
