using Api.Handlers;

namespace Api.Endpoints;

public static class NoteEndpoints
{
    public static WebApplication MapNoteEndpoints(this WebApplication app)
    {
        app.MapGet("/health", NoteHandlers.Health);
        app.MapGet("/secret", NoteHandlers.Secret).RequireAuthorization();
        app.MapPost("/notes", NoteHandlers.CreateNote).RequireAuthorization();
        app.MapPatch("/notes/{noteId}/title", NoteHandlers.RenameNote).RequireAuthorization();
        app.MapGet("/notes", NoteHandlers.ListNotes).RequireAuthorization();
        app.MapGet("/notes/cards", NoteHandlers.GetNoteCards).RequireAuthorization();
        app.MapGet("/notes/search", NoteHandlers.SearchNotes).RequireAuthorization();
        app.MapPut("/notes/{noteId}/content", NoteHandlers.EditContent).RequireAuthorization();
        app.MapGet("/notes/{noteId}", NoteHandlers.GetNote).RequireAuthorization();
        app.MapDelete("/notes/{noteId}", NoteHandlers.DeleteNote).RequireAuthorization();
        app.MapPatch("/notes/{noteId}/date", NoteHandlers.SetNoteDate).RequireAuthorization();
        app.MapPost("/notes/{noteId}/tags", NoteHandlers.PostTag).RequireAuthorization();
        app.MapDelete("/notes/{noteId}/tags/{tag}", NoteHandlers.DeleteTag).RequireAuthorization();
        app.MapPut("/notes/{noteId}/folder", NoteHandlers.MoveNoteToFolder).RequireAuthorization();
        app.MapDelete("/notes/{noteId}/folder", NoteHandlers.UnfileNote).RequireAuthorization();
        app.MapPost("/notes/{noteId}/calendar-link", NoteHandlers.LinkNoteToCalendar).RequireAuthorization();
        app.MapPost("/notes/{noteId}/actions", ActionItemHandlers.AddActionItem).RequireAuthorization();
        app.MapPost("/notes/{noteId}/actions/{actionId}/complete", ActionItemHandlers.CompleteActionItem).RequireAuthorization();
        app.MapPost("/notes/{noteId}/actions/{actionId}/reopen", ActionItemHandlers.ReopenActionItem).RequireAuthorization();
        app.MapDelete("/notes/{noteId}/actions/{actionId}", ActionItemHandlers.DeleteActionItem).RequireAuthorization();
        app.MapGet("/notes/{noteId}/actions", ActionItemHandlers.GetActions).RequireAuthorization();
        app.MapGet("/tags", TagHandlers.GetTags).RequireAuthorization();
        app.MapPost("/admin/projections/rebuild", AdminHandlers.RebuildProjections).RequireAuthorization();

        return app;
    }
}
