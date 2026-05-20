using Api.Services;

namespace Api.Integration;

public sealed class ThrowingStsCredentialService : IStsCredentialService
{
    public Task<TemporaryCredentials> AssumeTranscribeRoleAsync() =>
        throw new InvalidOperationException("TRANSCRIBE_ROLE_ARN is not configured");
}
