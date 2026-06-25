namespace Api.Services;

public interface IStsCredentialService
{
    Task<TemporaryCredentials> AssumeTranscribeRoleAsync();
}

public record TemporaryCredentials(
    string AccessKeyId,
    string SecretAccessKey,
    string SessionToken,
    DateTimeOffset Expiration
);
