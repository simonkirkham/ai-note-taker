using Api.Auth;
using Api.CommandHandlers;
using Api.Consistency;
using Domain.Todos;
using EventStore.Projections;

namespace Api.Handlers;

public static class TodoHandlers
{
    public static async Task<IResult> GetTodos(
        ITodoListStore store,
        IConsistencyGate gate,
        ICurrentUser currentUser,
        ICurrentWorkspace currentWorkspace,
        HttpContext http,
        CancellationToken ct)
    {
        // Read-your-writes: if the client presents the write token from its add-todo, wait
        // (bounded) until the async projector has applied it before reading the list. Absent
        // token → no wait. On timeout the read still returns, flagged X-Consistency: stale.
        var result = await gate.WaitAsync(http.Request.Headers["If-Consistent-With"], ct).ConfigureAwait(false);
        if (result.IsStale)
            http.Response.Headers["X-Consistency"] = "stale";

        var view = await store.QueryAllAsync(ct).ConfigureAwait(false);
        // Extend cutoff to 2 days back so any UTC-offset "today" is covered;
        // the frontend applies its own local-calendar-day filter.
        var cutoff = DateTimeOffset.UtcNow.Date.AddDays(-1);

        return Results.Ok(new
        {
            items = view.Items
                .Where(i => i.UserId == currentUser.UserId && currentWorkspace.Includes(i.WorkspaceId))
                .Where(i => i.CompletedAt is null || i.CompletedAt.Value.UtcDateTime.Date >= cutoff)
                .Select(i => new
                {
                    itemId = i.ItemId,
                    type = i.Type,
                    noteId = i.NoteId,
                    noteTitle = i.NoteTitle,
                    description = i.Description,
                    addedAt = i.AddedAt,
                    completedAt = i.CompletedAt
                })
        });
    }

    public static async Task<IResult> AddTodo(
        AddTodoRequest body,
        ITodoCommandHandler handler,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Description))
            return Results.BadRequest(new { error = "Description is required." });

        var todoId = new TodoId(Guid.NewGuid());
        var version = await handler.HandleAsync(new AddTodo(todoId, currentUser.UserId, body.Description.Trim(), body.Priority), ct).ConfigureAwait(false);
        // The write token (per-stream version) the client echoes into If-Consistent-With on its
        // todos refetch, so that read waits until the projector has applied this add.
        return Results.Ok(new { todoId = todoId.Value, consistencyToken = $"{todoId.ToStreamId()}@{version}" });
    }

    public static async Task<IResult> CompleteTodo(
        Guid todoId,
        ITodoCommandHandler handler,
        ITodoListStore store,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (!await OwnsTodoAsync(store, todoId, currentUser, ct).ConfigureAwait(false))
            return Results.NotFound();

        try
        {
            await handler.HandleAsync(new CompleteTodo(new TodoId(todoId), DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
            return Results.NoContent();
        }
        catch (InvalidOperationException) { return Results.Conflict(); }
    }

    public static async Task<IResult> ReopenTodo(
        Guid todoId,
        ITodoCommandHandler handler,
        ITodoListStore store,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (!await OwnsTodoAsync(store, todoId, currentUser, ct).ConfigureAwait(false))
            return Results.NotFound();

        try
        {
            await handler.HandleAsync(new ReopenTodo(new TodoId(todoId), DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
            return Results.NoContent();
        }
        catch (InvalidOperationException) { return Results.Conflict(); }
    }

    public static async Task<IResult> DeleteTodo(
        Guid todoId,
        ITodoCommandHandler handler,
        ITodoListStore store,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (!await OwnsTodoAsync(store, todoId, currentUser, ct).ConfigureAwait(false))
            return Results.NotFound();

        try
        {
            await handler.HandleAsync(new DeleteTodo(new TodoId(todoId), DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
            return Results.NoContent();
        }
        catch (InvalidOperationException) { return Results.Conflict(); }
    }

    static async Task<bool> OwnsTodoAsync(ITodoListStore store, Guid todoId, ICurrentUser currentUser, CancellationToken ct)
    {
        var item = await store.GetByIdAsync(todoId.ToString(), ct).ConfigureAwait(false);
        return item is not null && item.UserId == currentUser.UserId;
    }

    public static async Task<IResult> ReorderTodos(
        ReorderTodosRequest body,
        ITodoOrderCommandHandler handler,
        ICurrentWorkspace currentWorkspace,
        CancellationToken ct)
    {
        if (body.OrderedItemIds is null || body.OrderedItemIds.Count == 0)
            return Results.BadRequest(new { error = "orderedItemIds is required." });

        // Records ordering only (a list of item ids) — no ownership read against the async
        // projection, so it can't 404 on projector lag. Snapshot ids that no longer exist are
        // ignored when positions are applied.
        var version = await handler.HandleAsync(
            new ReorderTodos(currentWorkspace.WorkspaceId, body.OrderedItemIds, DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
        var streamId = TodoOrdering.StreamId(currentWorkspace.WorkspaceId);
        return Results.Ok(new { consistencyToken = $"{streamId}@{version}" });
    }
}

public record AddTodoRequest(string Description, string? Priority);

public record ReorderTodosRequest(IReadOnlyList<string> OrderedItemIds);
