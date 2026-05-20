using Amazon.SecurityToken;
using Domain.Notes;
using Api.CommandHandlers;
using Api.Contracts;
using Api.Services;
using EventStore.Projections;
using Api.Auth;
using Microsoft.Extensions.Logging;

namespace Api.Handlers;

public static class TranscriptionHandlers
{
    public static async Task<IResult> CompleteTranscription(
        Guid noteId,
        CompleteTranscriptionRequest req,
        INoteCommandHandler handler,
        INoteDetailStore noteDetailStore,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.TranscriptText)) return Results.UnprocessableEntity();
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId), ct);
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        try
        {
            await handler.HandleAsync(
                new Domain.Notes.CompleteTranscription(new NoteId(noteId), req.TranscriptText, req.DurationSeconds), ct);
        }
        catch (Exceptions.NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.NotFound(); }
        return Results.NoContent();
    }

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
