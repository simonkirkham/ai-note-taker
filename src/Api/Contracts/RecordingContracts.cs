namespace Api.Contracts;

public record RecordingPresignUploadResponse(string Key, string UploadUrl, string ContentType);

public record SaveRecordingRequest(string Key);

public record RecordingPresignDownloadResponse(string DownloadUrl);

public record DiarizeRequest(string Key);
