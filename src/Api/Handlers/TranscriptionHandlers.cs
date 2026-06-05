using Amazon.BedrockRuntime;
using Amazon.SecurityToken;
using Domain.ActionItems;
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
        await draftStore.DeleteAsync(new NoteId(noteId), ct);
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

    public static async Task<IResult> AnalyseNote(
        Guid noteId,
        INoteCommandHandler noteHandler,
        IActionItemCommandHandler actionHandler,
        INoteDetailStore noteDetailStore,
        INoteActionsStore noteActionsStore,
        IBedrockAnalysisService bedrockAnalysis,
        ICurrentUser currentUser,
        ILogger<IBedrockAnalysisService> logger,
        CancellationToken ct)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId), ct);
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();

        var content = detail.Content ?? "";
        if (string.IsNullOrWhiteSpace(detail.TranscriptText) && string.IsNullOrWhiteSpace(content))
            return Results.UnprocessableEntity();

        NoteAnalysisResult result;
        try
        {
            result = await bedrockAnalysis.AnalyseAsync(
                new NoteAnalysisRequest(content, detail.TranscriptText, currentUser.Name), ct);
        }
        catch (Exception ex) when (ex is AmazonBedrockRuntimeException or InvalidOperationException)
        {
            logger.LogError(ex, "Bedrock analysis failed: {ExceptionType} {Message}", ex.GetType().Name, ex.Message);
            return Results.Problem(statusCode: 503, title: "Analysis service unavailable", detail: ex.Message);
        }

        await noteHandler.HandleAsync(new RecordAnalysisSummary(
            new NoteId(noteId), result.Summary, result.DiscussionPoints, result.Decisions,
            result.ModelId, result.PromptVersion), ct);

        var existingTags = detail.Tags ?? [];
        var appliedTags = result.NewTags
            .Where(t => !existingTags.Contains(t, StringComparer.OrdinalIgnoreCase))
            .ToList();
        if (appliedTags.Count > 0)
            await noteHandler.HandleAsync(new RecordTagSuggestions(new NoteId(noteId), appliedTags, result.ModelId, result.PromptVersion), ct);
        foreach (var tag in appliedTags)
            await noteHandler.HandleAsync(new TagNote(new NoteId(noteId), tag), ct);

        var existingActionsView = await noteActionsStore.QueryByNoteAsync(new NoteId(noteId), ct);
        var existingDescriptions = existingActionsView.Actions
            .Select(a => a.Description)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var createdActionIds = new List<Guid>();
        foreach (var action in result.NewActionItems.Where(a => !existingDescriptions.Contains(a)))
        {
            var actionId = Guid.NewGuid();
            await actionHandler.HandleAsync(new AddActionItem(new ActionId(actionId), new NoteId(noteId), action), ct);
            createdActionIds.Add(actionId);
        }
        if (createdActionIds.Count > 0)
            await noteHandler.HandleAsync(new RecordActionItemSuggestions(new NoteId(noteId), createdActionIds, result.ModelId, result.PromptVersion), ct);

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
