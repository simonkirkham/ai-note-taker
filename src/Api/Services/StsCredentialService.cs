using Amazon.SecurityToken;
using Amazon.SecurityToken.Model;

namespace Api.Services;

public sealed class StsCredentialService : IStsCredentialService
{
    private readonly IAmazonSecurityTokenService _sts;
    private readonly string _transcribeRoleArn;

    public StsCredentialService(IAmazonSecurityTokenService sts)
    {
        _sts = sts;
        _transcribeRoleArn = Environment.GetEnvironmentVariable("TRANSCRIBE_ROLE_ARN") ?? "";
    }

    public async Task<TemporaryCredentials> AssumeTranscribeRoleAsync()
    {
        if (string.IsNullOrEmpty(_transcribeRoleArn))
            throw new InvalidOperationException("TRANSCRIBE_ROLE_ARN is not configured.");

        var response = await _sts.AssumeRoleAsync(new AssumeRoleRequest
        {
            RoleArn = _transcribeRoleArn,
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
