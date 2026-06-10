namespace Api.Services;

public interface INoteImageStore
{
    string PresignUpload(string key, string contentType);
    string PresignDownload(string key);
}
