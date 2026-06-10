namespace Api.Contracts;

public record PresignUploadRequest(string ContentType, long ContentLength);
