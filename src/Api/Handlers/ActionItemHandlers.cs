using Domain.ActionItems;
using Domain.Notes;
using EventStore.Projections;
using Api.Contracts;
using AddActionItemCmd = Domain.ActionItems.AddActionItem;
using CompleteActionItemCmd = Domain.ActionItems.CompleteActionItem;
using ReopenActionItemCmd = Domain.ActionItems.ReopenActionItem;
using DeleteActionItemCmd = Domain.ActionItems.DeleteActionItem;

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

    public static async Task<IResult> CompleteActionItem(
        Guid noteId,
        Guid actionId,
        ActionItemCommandHandler handler)
    {
        try
        {
            await handler.HandleAsync(new CompleteActionItemCmd(new ActionId(actionId), DateTimeOffset.UtcNow));
        }
        catch (ActionItemNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        return Results.Ok();
    }

    public static async Task<IResult> ReopenActionItem(
        Guid noteId,
        Guid actionId,
        ActionItemCommandHandler handler)
    {
        try
        {
            await handler.HandleAsync(new ReopenActionItemCmd(new ActionId(actionId), DateTimeOffset.UtcNow));
        }
        catch (ActionItemNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        return Results.Ok();
    }

    public static async Task<IResult> DeleteActionItem(
        Guid noteId,
        Guid actionId,
        ActionItemCommandHandler handler)
    {
        try
        {
            await handler.HandleAsync(new DeleteActionItemCmd(new ActionId(actionId), DateTimeOffset.UtcNow));
        }
        catch (ActionItemNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        return Results.NoContent();
    }

    public static async Task<IResult> GetActions(Guid noteId, INoteDetailStore noteDetailStore, INoteActionsStore store)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null) return Results.NotFound();

        var view = await store.QueryByNoteAsync(new NoteId(noteId));
        return Results.Ok(new
        {
            noteId = noteId,
            actions = view.Actions.Select(a => new
            {
                actionId = a.ActionId.Value,
                description = a.Description,
                completed = a.Completed,
                addedAt = a.AddedAt,
                completedAt = a.CompletedAt
            })
        });
    }
}
