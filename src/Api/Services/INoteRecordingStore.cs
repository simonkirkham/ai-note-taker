namespace Api.Services;

public interface INoteRecordingStore
{
    string PresignUpload(string key, string contentType);
    string PresignDownload(string key);
}
