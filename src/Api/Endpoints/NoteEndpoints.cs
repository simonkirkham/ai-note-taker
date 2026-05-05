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
            app.MapGet("/notes/{noteId}", NoteHandlers.GetNote);
            
            return app;
        }
    }
}
