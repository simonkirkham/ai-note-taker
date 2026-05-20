using Amazon.SecurityToken;
using Api.Services;
using Microsoft.Extensions.Logging;

namespace Api.Handlers;

public static class TranscriptionHandlers
{
    public static async Task<IResult> GetCredentials(IStsCredentialService sts, ILogger<IStsCredentialService> logger)
    {
        try
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
        catch (Exception ex) when (ex is AmazonSecurityTokenServiceException or InvalidOperationException)
        {
            logger.LogError(ex, "STS AssumeRole failed: {ExceptionType} {Message}", ex.GetType().Name, ex.Message);
            return Results.Problem(statusCode: 503, title: "Transcription service unavailable", detail: ex.Message);
        }
    }
}
