using Domain.ActionItems;
using Domain.Notes;
using EventStore.Projections;
using Api.Auth;
using Api.Consistency;
using Api.Contracts;
using Api.CommandHandlers;
using Api.Exceptions;
using AddActionItemCmd = Domain.ActionItems.AddActionItem;
using CompleteActionItemCmd = Domain.ActionItems.CompleteActionItem;
using ReopenActionItemCmd = Domain.ActionItems.ReopenActionItem;
using DeleteActionItemCmd = Domain.ActionItems.DeleteActionItem;

namespace Api.Handlers;

public static class ActionItemHandlers
{
    // Read-your-writes (RYW-3a): surface the action stream's new version as the write token so the
    // client can echo it into If-Consistent-With on its next actions read, making that read wait
    // until the async projector has applied this write.
    private static void SetConsistencyToken(HttpResponse response, ActionId actionId, long version) =>
        response.Headers["X-Consistency-Token"] = $"{actionId.ToStreamId()}@{version}";

    public static async Task<IResult> AddActionItem(
        Guid noteId,
        AddActionItemRequest req,
        HttpResponse response,
        IActionItemCommandHandler handler,
        INoteDetailStore noteDetailStore,
        ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        var actionId = req.ActionId is { } id && id != Guid.Empty
            ? new ActionId(id)
            : new ActionId(Guid.NewGuid());
        long version;
        try
        {
            version = await handler.HandleAsync(new AddActionItemCmd(actionId, new NoteId(noteId), req.Description));
        }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        SetConsistencyToken(response, actionId, version);
        return Results.Created($"/notes/{noteId}/actions/{actionId}", new { actionId = actionId.Value });
    }

    public static async Task<IResult> CompleteActionItem(
        Guid noteId,
        Guid actionId,
        HttpResponse response,
        IActionItemCommandHandler handler,
        INoteDetailStore noteDetailStore,
        ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try
        {
            version = await handler.HandleAsync(new CompleteActionItemCmd(new ActionId(actionId), DateTimeOffset.UtcNow));
        }
        catch (ActionItemNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        SetConsistencyToken(response, new ActionId(actionId), version);
        return Results.Ok();
    }

    public static async Task<IResult> ReopenActionItem(
        Guid noteId,
        Guid actionId,
        HttpResponse response,
        IActionItemCommandHandler handler,
        INoteDetailStore noteDetailStore,
        ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try
        {
            version = await handler.HandleAsync(new ReopenActionItemCmd(new ActionId(actionId), DateTimeOffset.UtcNow));
        }
        catch (ActionItemNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        SetConsistencyToken(response, new ActionId(actionId), version);
        return Results.Ok();
    }

    public static async Task<IResult> DeleteActionItem(
        Guid noteId,
        Guid actionId,
        HttpResponse response,
        IActionItemCommandHandler handler,
        INoteDetailStore noteDetailStore,
        ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try
        {
            version = await handler.HandleAsync(new DeleteActionItemCmd(new ActionId(actionId), DateTimeOffset.UtcNow));
        }
        catch (ActionItemNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        SetConsistencyToken(response, new ActionId(actionId), version);
        return Results.NoContent();
    }

    public static async Task<IResult> GetActions(
        Guid noteId,
        INoteDetailStore noteDetailStore,
        INoteActionsStore store,
        ICurrentUser currentUser,
        IConsistencyGate gate,
        HttpContext http,
        CancellationToken ct)
    {
        // Read-your-writes: if the client presents the write token from its last action write, wait
        // (bounded) until the async projector has applied it before reading. Absent token → no
        // wait. On timeout the read still returns, flagged X-Consistency: stale.
        var consistency = await gate.WaitAsync(http.Request.Headers["If-Consistent-With"], ct).ConfigureAwait(false);
        if (consistency.IsStale) http.Response.Headers["X-Consistency"] = "stale";

        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();

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
