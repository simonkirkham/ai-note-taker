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
        INoteAuthorizer noteAuthorizer,
        ICurrentUser currentUser)
    {
        if (!await noteAuthorizer.OwnsNoteAsync(new NoteId(noteId), currentUser.UserId)) return Results.NotFound();
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
        INoteAuthorizer noteAuthorizer,
        ICurrentUser currentUser)
    {
        if (!await noteAuthorizer.OwnsNoteAsync(new NoteId(noteId), currentUser.UserId)) return Results.NotFound();
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
        INoteAuthorizer noteAuthorizer,
        ICurrentUser currentUser)
    {
        if (!await noteAuthorizer.OwnsNoteAsync(new NoteId(noteId), currentUser.UserId)) return Results.NotFound();
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
        INoteAuthorizer noteAuthorizer,
        ICurrentUser currentUser)
    {
        if (!await noteAuthorizer.OwnsNoteAsync(new NoteId(noteId), currentUser.UserId)) return Results.NotFound();
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

        // This read runs in the Query Lambda (27-D), which has NO event-store access — so it cannot use
        // the event-stream INoteAuthorizer (that 500s here). Authorize against the NoteDetail projection.
        // The gate above waited on the ACTION stream's position, but ownership reads the NOTE's
        // projection — a DIFFERENT stream. DynamoDB Streams don't guarantee cross-key order, so the
        // action can be folded BEFORE the note (NoteDetail not yet built) → a spurious 404 even though
        // the gate "succeeded". The gate's presence wait rides out that cross-stream lag with the same
        // bounded interval/cap/logging as the version wait above (Query Lambda can't read the event store
        // to check existence authoritatively). ~2s worst case, only when null; happy path costs nothing.
        var detail = await gate.WaitForPresenceAsync(c => noteDetailStore.GetAsync(new NoteId(noteId), c), $"note:{noteId}", ct).ConfigureAwait(false);
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
