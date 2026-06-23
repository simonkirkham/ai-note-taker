using Api.Services;

namespace Api.Integration;

public sealed class FakeNoteRecordingStore : INoteRecordingStore
{
    public string PresignUpload(string key, string contentType) =>
        $"https://fake-s3.local/recordings/upload/{key}?ct={Uri.EscapeDataString(contentType)}";

    public string PresignDownload(string key) =>
        $"https://fake-s3.local/recordings/get/{key}";
}
