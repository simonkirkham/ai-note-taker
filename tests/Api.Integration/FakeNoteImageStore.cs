using Api.Services;

namespace Api.Integration;

public sealed class FakeNoteImageStore : INoteImageStore
{
    public List<string> PurgedNoteIds { get; } = [];
    public bool PurgeThrows { get; set; }

    public string PresignUpload(string key, string contentType) =>
        $"https://fake-s3.local/upload/{key}?ct={Uri.EscapeDataString(contentType)}";

    public string PresignDownload(string key) =>
        $"https://fake-s3.local/get/{key}";

    public Task PurgeNoteAsync(string noteId, CancellationToken ct = default)
    {
        if (PurgeThrows) throw new InvalidOperationException("simulated non-S3 purge failure");
        PurgedNoteIds.Add(noteId);
        return Task.CompletedTask;
    }
}
