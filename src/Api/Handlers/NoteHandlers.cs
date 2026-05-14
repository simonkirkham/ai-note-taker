using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using EventStore;
using EventStore.Projections;
using Domain.Notes;
using Api.Contracts;
using EditContentCmd = Domain.Notes.EditContent;

namespace Api.Handlers;

public static class NoteHandlers
{
    private const int MaxPreviewLength = 120;
    public static async Task<IResult> Health(IDynamoHealthCheck dynamo)
    {
        var dh = await dynamo.CheckAsync();
        return Results.Ok(new
        {
            status = dh.Reachable ? "ok" : "degraded",
            dynamo = new { status = dh.Reachable ? "ok" : "error", error = dh.Error }
        });
    }

    public static IResult Secret() => Results.Ok(new { status = "shhhh...." });

    public static async Task<IResult> CreateNote(HttpRequest request, NoteCommandHandler handler)
    {
        CreateNoteRequest? req = null;
        if (request.HasJsonContentType())
            req = await request.ReadFromJsonAsync<CreateNoteRequest>();
        var noteId = req?.NoteId is { } id && id != Guid.Empty ? new NoteId(id) : new NoteId(Guid.NewGuid());
        try { await handler.HandleAsync(new CreateNote(noteId)); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        return Results.Created($"/notes/{noteId}", new { noteId = noteId.Value });
    }

    public static async Task<IResult> RenameNote(Guid noteId, RenameNoteRequest req, NoteCommandHandler handler)
    {
        try { await handler.HandleAsync(new RenameNote(new NoteId(noteId), req.Title)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.Ok();
    }

    public static async Task<IResult> ListNotes(INoteTitleListStore projStore)
    {
        var view = await projStore.QueryAllAsync();
        var items = view.Items
            .OrderByDescending(i => i.LastModifiedAt)
            .Select(i => new { noteId = i.NoteId.Value, title = i.Title, lastModifiedAt = i.LastModifiedAt });
        return Results.Ok(new { items });
    }

    public static async Task<IResult> EditContent(Guid noteId, EditContentRequest req, NoteCommandHandler handler)
    {
        try { await handler.HandleAsync(new EditContentCmd(new NoteId(noteId), req.Content)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> GetNote(Guid noteId, INoteDetailStore noteDetailStore)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null) return Results.NotFound();
        return Results.Ok(new
        {
            noteId         = detail.NoteId.Value,
            title          = detail.Title,
            content        = detail.Content,
            date           = detail.Date,
            createdAt      = detail.CreatedAt,
            lastModifiedAt = detail.LastModifiedAt
        });
    }

    public static async Task<IResult> SetNoteDate(Guid noteId, SetNoteDateRequest req, NoteCommandHandler handler)
    {
        try { await handler.HandleAsync(new Domain.Notes.SetNoteDate(new NoteId(noteId), req.Date)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.Ok();
    }

    public static async Task<IResult> DeleteNote(Guid noteId, NoteCommandHandler handler)
    {
        try { await handler.HandleAsync(new Domain.Notes.DeleteNote(new NoteId(noteId))); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> GetNoteCards(INoteCardListStore store, CancellationToken ct)
    {
        var all = await store.QueryAllAsync(ct).ConfigureAwait(false);
        var cards = all
            .Where(c => !c.Deleted)
            .Select(c =>
            {
                var preview = c.Content.Length > MaxPreviewLength
                    ? c.Content[..(MaxPreviewLength - 1)] + "…"
                    : c.Content;
                var openActions = c.ActionItems
                    .Where(a => !a.Completed)
                    .Select(a => new { actionId = a.ActionId.Value, description = a.Description });
                return new
                {
                    noteId         = c.NoteId.Value,
                    title          = c.Title,
                    contentPreview = preview,
                    date           = c.Date,
                    openActions,
                    createdAt      = c.CreatedAt
                };
            });
        return Results.Ok(new { cards });
    }
}
