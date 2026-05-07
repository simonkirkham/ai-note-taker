using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Api.Handlers;

namespace Api.Endpoints
{
    public static class NoteEndpoints
    {
        public static WebApplication MapNoteEndpoints(this WebApplication app)
        {
            app.MapGet("/health", NoteHandlers.Health);
            app.MapGet("/secret", NoteHandlers.Secret);
            app.MapPost("/notes", NoteHandlers.CreateNote);
            app.MapPatch("/notes/{noteId}/title", NoteHandlers.RenameNote);
            app.MapGet("/notes", NoteHandlers.ListNotes);
            app.MapPut("/notes/{noteId}/content", NoteHandlers.EditContent);
            app.MapGet("/notes/{noteId}", NoteHandlers.GetNote);
            app.MapDelete("/notes/{noteId}", NoteHandlers.DeleteNote);
            app.MapPost("/admin/projections/rebuild", AdminHandlers.RebuildProjections);
            
            return app;
        }
    }
}
