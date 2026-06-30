using Api.Auth;
using Api.Handlers;

namespace Api.Endpoints;

public static class NoteEndpoints
{
    public static WebApplication MapNoteEndpoints(this WebApplication app)
    {
        // Global (workspace-independent) routes.
        app.MapGet("/health", NoteHandlers.Health);
        app.MapGet("/secret", NoteHandlers.Secret).RequireAuthorization();
        app.MapPost("/admin/projections/rebuild", AdminHandlers.RebuildProjections).RequireAuthorization();

        // Workspace-scoped content routes live only under `/w/{workspaceId}`: a validation
        // filter rejects another user's workspace (404) before the handler runs, and
        // `ICurrentWorkspace` reads the prefix. The rootless fallback (pre-23-D migration
        // scaffold) was removed in 23-G now that the frontend always prefixes.
        MapWorkspaceScopedRoutes(app.MapGroup("/w/{workspaceId}").AddEndpointFilter<WorkspaceValidationFilter>());

        return app;
    }

    private static void MapWorkspaceScopedRoutes(IEndpointRouteBuilder routes)
    {
        routes.MapPost("/notes", NoteHandlers.CreateNote).RequireAuthorization();
        routes.MapPatch("/notes/{noteId}/title", NoteHandlers.RenameNote).RequireAuthorization();
        routes.MapGet("/notes", NoteHandlers.ListNotes).RequireAuthorization();
        routes.MapGet("/notes/cards", NoteHandlers.GetNoteCards).RequireAuthorization();
        routes.MapGet("/notes/search", NoteHandlers.SearchNotes).RequireAuthorization();
        routes.MapPut("/notes/{noteId}/content", NoteHandlers.EditContent).RequireAuthorization();
        routes.MapGet("/notes/{noteId}", NoteHandlers.GetNote).RequireAuthorization();
        routes.MapDelete("/notes/{noteId}", NoteHandlers.DeleteNote).RequireAuthorization();
        routes.MapPatch("/notes/{noteId}/date", NoteHandlers.SetNoteDate).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/tags", NoteHandlers.PostTag).RequireAuthorization();
        routes.MapDelete("/notes/{noteId}/tags/{tag}", NoteHandlers.DeleteTag).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/agenda-items", NoteHandlers.PostAgendaItem).RequireAuthorization();
        routes.MapPut("/notes/{noteId}/folder", NoteHandlers.MoveNoteToFolder).RequireAuthorization();
        routes.MapDelete("/notes/{noteId}/folder", NoteHandlers.UnfileNote).RequireAuthorization();
        routes.MapPut("/notes/{noteId}/workspace", NoteHandlers.MoveNoteToWorkspace).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/calendar-link", NoteHandlers.LinkNoteToCalendar).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/actions", ActionItemHandlers.AddActionItem).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/actions/{actionId}/complete", ActionItemHandlers.CompleteActionItem).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/actions/{actionId}/reopen", ActionItemHandlers.ReopenActionItem).RequireAuthorization();
        routes.MapPut("/notes/{noteId}/actions/{actionId}", ActionItemHandlers.EditActionItem).RequireAuthorization();
        routes.MapDelete("/notes/{noteId}/actions/{actionId}", ActionItemHandlers.DeleteActionItem).RequireAuthorization();
        routes.MapGet("/notes/{noteId}/actions", ActionItemHandlers.GetActions).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/images/presign-upload", NoteImageHandlers.PresignUpload).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/images/resolve", NoteImageHandlers.ResolveImages).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/recording/presign-upload", NoteRecordingHandlers.PresignUpload).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/recording", NoteRecordingHandlers.SaveRecording).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/recording/presign-download", NoteRecordingHandlers.PresignDownload).RequireAuthorization();
        routes.MapPost("/notes/{noteId}/transcription/diarize", NoteRecordingHandlers.Diarize).RequireAuthorization();
        routes.MapGet("/tags", TagHandlers.GetTags).RequireAuthorization();
    }
}
