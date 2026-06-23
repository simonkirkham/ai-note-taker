using Amazon.S3;
using Amazon.S3.Model;

namespace Api.Services;

public sealed class S3NoteRecordingStore(IAmazonS3 s3, string bucketName) : INoteRecordingStore
{
    static readonly TimeSpan UploadTtl = TimeSpan.FromMinutes(15);
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
}
