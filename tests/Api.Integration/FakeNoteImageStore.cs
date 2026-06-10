using Api.Services;

namespace Api.Integration;

public sealed class FakeNoteImageStore : INoteImageStore
{
    public List<string> PurgedNoteIds { get; } = [];

    public string PresignUpload(string key, string contentType) =>
        $"https://fake-s3.local/upload/{key}?ct={Uri.EscapeDataString(contentType)}";

    public string PresignDownload(string key) =>
        $"https://fake-s3.local/get/{key}";

    public Task PurgeNoteAsync(string noteId, CancellationToken ct = default)
    {
        PurgedNoteIds.Add(noteId);
        return Task.CompletedTask;
    }
}
