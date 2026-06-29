namespace Api.Services;

public interface INoteImageStore
{
    string PresignUpload(string key, string contentType);
    string PresignDownload(string key);
    Task PurgeNoteAsync(string noteId, CancellationToken ct = default);
}
