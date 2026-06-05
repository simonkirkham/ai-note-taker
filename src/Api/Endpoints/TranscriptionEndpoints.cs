using Api.Handlers;

namespace Api.Endpoints;

public static class TranscriptionEndpoints
{
    public static void MapTranscriptionEndpoints(this WebApplication app)
    {
        app.MapGet("/transcription/credentials", TranscriptionHandlers.GetCredentials)
           .RequireAuthorization();
        app.MapPost("/notes/{noteId:guid}/transcription", TranscriptionHandlers.CompleteTranscription)
           .RequireAuthorization();
        app.MapPut("/notes/{noteId:guid}/transcription/draft", TranscriptionHandlers.SaveDraft)
           .RequireAuthorization();
        app.MapDelete("/notes/{noteId:guid}/transcription/draft", TranscriptionHandlers.DiscardDraft)
           .RequireAuthorization();
        app.MapPost("/notes/{noteId:guid}/analyse", TranscriptionHandlers.AnalyseNote)
           .RequireAuthorization();
    }
}
