using Amazon.SecurityToken;
using Amazon.SecurityToken.Model;

namespace Api.Services;

public sealed class StsCredentialService : IStsCredentialService
{
    private readonly IAmazonSecurityTokenService _sts;

    public StsCredentialService(IAmazonSecurityTokenService sts)
    {
        _sts = sts;
    }

    public async Task<TemporaryCredentials> AssumeTranscribeRoleAsync()
    {
        // Read at call time, not construction time — SnapStart freezes constructor state
        // but refreshes environment variables on restore.
        var roleArn = Environment.GetEnvironmentVariable("TRANSCRIBE_ROLE_ARN") ?? "";
        if (string.IsNullOrEmpty(roleArn))
            throw new InvalidOperationException("TRANSCRIBE_ROLE_ARN is not configured.");

        var response = await _sts.AssumeRoleAsync(new AssumeRoleRequest
        {
            RoleArn = roleArn,
            RoleSessionName = "transcribe-browser-session",
            DurationSeconds = 900
        });

        var c = response.Credentials;
        var expiration = c.Expiration is { } exp
            ? new DateTimeOffset(exp, TimeSpan.Zero)
            : DateTimeOffset.UtcNow.AddMinutes(15);
        return new TemporaryCredentials(
            c.AccessKeyId,
            c.SecretAccessKey,
            c.SessionToken,
            expiration
        );
    }
}
