using Api.Services;

namespace Api.Integration;

public sealed class FakeNoteImageStore : INoteImageStore
{
    public string PresignUpload(string key, string contentType) =>
        $"https://fake-s3.local/upload/{key}?ct={Uri.EscapeDataString(contentType)}";

    public string PresignDownload(string key) =>
        $"https://fake-s3.local/get/{key}";
}
