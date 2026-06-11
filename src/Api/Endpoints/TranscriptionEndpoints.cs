using Api.Auth;
using Api.Handlers;

namespace Api.Endpoints;

public static class TranscriptionEndpoints
{
    public static void MapTranscriptionEndpoints(this WebApplication app)
    {
        // Transcription credentials are per-user (not workspace-scoped) — stays global.
        app.MapGet("/transcription/credentials", TranscriptionHandlers.GetCredentials)
           .RequireAuthorization();

        // Note-scoped transcription/analyse routes live under `/w/{workspaceId}` like every
        // other content route. These were previously rootless-only; 23-G brings them into
        // the prefixed group (the validation filter rejects another user's workspace).
        var scoped = app.MapGroup("/w/{workspaceId}").AddEndpointFilter<WorkspaceValidationFilter>();
        scoped.MapPost("/notes/{noteId:guid}/transcription", TranscriptionHandlers.CompleteTranscription)
           .RequireAuthorization();
        scoped.MapPut("/notes/{noteId:guid}/transcription/draft", TranscriptionHandlers.SaveDraft)
           .RequireAuthorization();
        scoped.MapDelete("/notes/{noteId:guid}/transcription/draft", TranscriptionHandlers.DiscardDraft)
           .RequireAuthorization();
        scoped.MapPost("/notes/{noteId:guid}/analyse", TranscriptionHandlers.AnalyseNote)
           .RequireAuthorization();
    }
}
