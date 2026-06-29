namespace Api.Contracts;

public record PresignUploadResponse(string ImageId, string Key, string UploadUrl, string ContentType);
