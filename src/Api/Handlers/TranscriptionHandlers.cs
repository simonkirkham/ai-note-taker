using Api.Services;

namespace Api.Handlers;

public static class TranscriptionHandlers
{
    public static async Task<IResult> GetCredentials(IStsCredentialService sts)
    {
        var creds = await sts.AssumeTranscribeRoleAsync();
        var region = Environment.GetEnvironmentVariable("AWS_REGION")
                  ?? Environment.GetEnvironmentVariable("AWS_DEFAULT_REGION")
                  ?? "eu-west-1";

        return Results.Ok(new
        {
            accessKeyId = creds.AccessKeyId,
            secretAccessKey = creds.SecretAccessKey,
            sessionToken = creds.SessionToken,
            expiration = creds.Expiration,
            region
        });
    }
}
