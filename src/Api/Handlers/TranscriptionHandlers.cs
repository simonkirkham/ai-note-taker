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
        ITranscriptionDraftStore draftStore,
        ICurrentUser currentUser,
        ILoggerFactory loggerFactory,
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
        // A clean completion supersedes any in-progress draft; drop it so a later
        // reload does not offer a stale recovery for transcript now committed.
        // Best-effort: the transcript is already committed, and a leftover draft is
        // a prefix of it, so the read-time guard suppresses it anyway — never fail
        // the request on a draft-store hiccup.
        try
        {
            await draftStore.DeleteAsync(new NoteId(noteId), ct);
        }
        catch (Exception ex)
        {
            loggerFactory.CreateLogger("Api.Handlers.TranscriptionHandlers")
                .LogWarning(ex, "Failed to delete transcription draft after completing note {NoteId}; a stale draft will be suppressed on read.", noteId);
        }
        return Results.NoContent();
    }

    public static async Task<IResult> SaveDraft(
        Guid noteId,
        CompleteTranscriptionRequest req,
        ITranscriptionDraftStore draftStore,
        INoteDetailStore noteDetailStore,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.TranscriptText)) return Results.UnprocessableEntity();
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId), ct);
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        await draftStore.SaveAsync(
            new TranscriptionDraft(new NoteId(noteId), currentUser.UserId, req.TranscriptText, req.DurationSeconds, DateTimeOffset.UtcNow), ct);
        return Results.NoContent();
    }

    public static async Task<IResult> DiscardDraft(
        Guid noteId,
        ITranscriptionDraftStore draftStore,
        INoteDetailStore noteDetailStore,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId), ct);
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        await draftStore.DeleteAsync(new NoteId(noteId), ct);
        return Results.NoContent();
    }

    // Thin wrapper over INoteAnalysisService (33-B2): authorize ownership (404) here, then delegate
    // the Bedrock + record flow to the service with the scoped identity. The same service is invoked
    // headless by the TranscribeCompletion Lambda after diarization. Manual analyse is never deferred.
    public static async Task<IResult> AnalyseNote(
        Guid noteId,
        INoteAnalysisService analysis,
        INoteDetailStore noteDetailStore,
        ICurrentUser currentUser,
        ICurrentWorkspace currentWorkspace,
        CancellationToken ct)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId), ct);
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();

        var outcome = await analysis.AnalyseAsync(new NoteId(noteId), currentUser.UserId,
            currentWorkspace.WorkspaceId, currentUser.Name, transcriptOverride: null, ct);
        return outcome switch
        {
            AnalysisOutcome.NothingToAnalyse => Results.UnprocessableEntity(),
            AnalysisOutcome.ServiceUnavailable => Results.Problem(statusCode: 503, title: "Analysis service unavailable"),
            _ => Results.NoContent(),
        };
    }

    // A pasted transcript is appended whole as one DynamoDB event (~400 KB item limit). Cap the raw
    // bytes well under that so an over-long paste is a clean 400, not an unhandled 500 at AppendAsync.
    // ~350 KB leaves headroom for the event envelope/metadata; ~2 hours of dense transcript fits.
    private const int MaxTranscriptBytes = 350_000;

    // Phase 38: create a note from pasted transcript text and analyse it in one server-side flow.
    // Returns 201 + the note id + the post-analysis consistency token; a Bedrock outage still
    // returns 201 (the transcript is saved, the note opens re-analysable). Empty or over-long text → 400.
    public static async Task<IResult> ImportTranscript(
        ImportTranscriptRequest req,
        HttpResponse response,
        ITranscriptImportService import,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.TranscriptText))
        {
            loggerFactory.CreateLogger("Api.Handlers.TranscriptionHandlers")
                .LogWarning("Rejected transcript import: empty transcript text");
            return Results.BadRequest();
        }
        if (System.Text.Encoding.UTF8.GetByteCount(req.TranscriptText) > MaxTranscriptBytes)
        {
            loggerFactory.CreateLogger("Api.Handlers.TranscriptionHandlers")
                .LogWarning("Rejected transcript import: transcript exceeds {MaxBytes} bytes", MaxTranscriptBytes);
            return Results.BadRequest();
        }

        var result = await import.ImportAsync(req.TranscriptText, ct);
        response.Headers["X-Consistency-Token"] =
            $"{new NoteId(result.NoteId).ToStreamId()}@{result.Version}";
        return Results.Created($"/notes/{result.NoteId}", new { noteId = result.NoteId });
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
