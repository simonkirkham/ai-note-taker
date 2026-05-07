using Domain.ActionItems;
using Domain.Notes;
using EventStore.Projections;
using Microsoft.AspNetCore.Http;
using Api.Contracts;
using AddActionItemCmd = Domain.ActionItems.AddActionItem;

namespace Api.Handlers;

public static class ActionItemHandlers
{
    public static async Task<IResult> AddActionItem(
        Guid noteId,
        AddActionItemRequest req,
        ActionItemCommandHandler handler)
    {
        var actionId = req.ActionId is { } id && id != Guid.Empty
            ? new ActionId(id)
            : new ActionId(Guid.NewGuid());
        try
        {
            await handler.HandleAsync(new AddActionItemCmd(actionId, new NoteId(noteId), req.Description));
        }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        return Results.Created($"/notes/{noteId}/actions/{actionId}", new { actionId = actionId.Value });
    }

    public static async Task<IResult> GetActions(Guid noteId, INoteActionsStore store)
    {
        var view = await store.QueryByNoteAsync(new NoteId(noteId));
        return Results.Ok(new
        {
            noteId  = noteId,
            actions = view.Actions.Select(a => new
            {
                actionId    = a.ActionId.Value,
                description = a.Description,
                completed   = a.Completed,
                addedAt     = a.AddedAt,
                completedAt = a.CompletedAt
            })
        });
    }
}
