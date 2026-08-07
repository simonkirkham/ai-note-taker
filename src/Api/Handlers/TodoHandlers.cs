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
        ILogger<TodoListView> logger,
        HttpContext http,
        CancellationToken ct)
    {
        // Read-your-writes: if the client presents the write token from its add-todo, wait
        // (bounded) until the async projector has applied it before reading the list. Absent
        // token → no wait. On timeout the read still returns, flagged X-Consistency: stale.
        var result = await gate.WaitAsync(http.Request.Headers["If-Consistent-With"], ct).ConfigureAwait(false);
        if (result.IsStale)
            http.Response.Headers["X-Consistency"] = "stale";

        // Independent reads — the list and the Today-line marker are separate keys.
        var itemsTask = store.QueryAllAsync(ct);
        var anchorTask = store.GetTodayLineAnchorAsync(currentUser.UserId, currentWorkspace.WorkspaceId, ct);
        await Task.WhenAll(itemsTask, anchorTask).ConfigureAwait(false);
        var view = await itemsTask.ConfigureAwait(false);
        var storedAnchor = await anchorTask.ConfigureAwait(false);

        // Extend cutoff to 2 days back so any UTC-offset "today" is covered;
        // the frontend applies its own local-calendar-day filter.
        var cutoff = DateTimeOffset.UtcNow.Date.AddDays(-1);
        var visible = view.Items
            .Where(i => i.UserId == currentUser.UserId && currentWorkspace.Includes(i.WorkspaceId))
            .Where(i => i.CompletedAt is null || i.CompletedAt.Value.UtcDateTime.Date >= cutoff)
            .ToList();

        var todayLineAnchorItemId = ResolveTodayLine(visible, storedAnchor);
        // Durable relocation happens in the projector when the anchor stops being open, so a
        // mismatch here is only the transient window before that lands — Debug, not Information,
        // or it would log on every home-page poll for as long as the window is open.
        if (storedAnchor is not null && todayLineAnchorItemId != storedAnchor)
            logger.LogDebug("Today line resolved past its stored anchor for workspace {WorkspaceId}: {StoredAnchor} -> {ResolvedAnchor}",
                currentWorkspace.WorkspaceId, storedAnchor, todayLineAnchorItemId ?? "(below everything)");

        return Results.Ok(new
        {
            items = visible.Select(i => new
            {
                itemId = i.ItemId,
                type = i.Type,
                noteId = i.NoteId,
                noteTitle = i.NoteTitle,
                description = i.Description,
                addedAt = i.AddedAt,
                completedAt = i.CompletedAt
            }),
            todayLineAnchorItemId
        });
    }

    // The stored anchor is the item the line sits immediately ABOVE. The projector relocates it
    // durably the moment that item stops being open, so this read-side resolution only covers the
    // transient window before that lands: report the first still-OPEN item at or after the anchor's
    // place in the order. null = the line is below everything.
    static string? ResolveTodayLine(IReadOnlyList<TodoItem> ordered, string? storedAnchor)
    {
        if (storedAnchor is null)
            return null;

        var anchorIndex = -1;
        for (var i = 0; i < ordered.Count; i++)
            if (ordered[i].ItemId == storedAnchor)
            {
                anchorIndex = i;
                break;
            }
        if (anchorIndex < 0)
            return null;

        for (var i = anchorIndex; i < ordered.Count; i++)
            if (ordered[i].CompletedAt is null)
                return ordered[i].ItemId;
        return null;
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

    public static async Task<IResult> EditTodo(
        Guid todoId,
        EditTodoRequest body,
        ITodoCommandHandler handler,
        ITodoListStore store,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Description))
            return Results.BadRequest(new { error = "Description is required." });
        if (!await OwnsTodoAsync(store, todoId, currentUser, ct).ConfigureAwait(false))
            return Results.NotFound();

        try
        {
            await handler.HandleAsync(new EditTodo(new TodoId(todoId), body.Description.Trim(), DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
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
        // Sanity cap — the home list is small; a huge payload is a client bug, and each id fans
        // into a parallel UpdateItem in the projector.
        if (body.OrderedItemIds.Count > 1000)
            return Results.BadRequest(new { error = "Too many items to reorder." });

        // Records ordering only (a list of item ids) — no ownership read against the async
        // projection, so it can't 404 on projector lag. Snapshot ids that no longer exist are
        // ignored when positions are applied.
        var version = await handler.HandleAsync(
            new ReorderTodos(currentWorkspace.WorkspaceId, body.OrderedItemIds, DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
        var streamId = TodoOrdering.StreamId(currentWorkspace.WorkspaceId);
        return Results.Ok(new { consistencyToken = $"{streamId}@{version}" });
    }

    public static async Task<IResult> SetTodayLine(
        SetTodayLineRequest body,
        ITodoOrderCommandHandler handler,
        ICurrentWorkspace currentWorkspace,
        CancellationToken ct)
    {
        // null is the meaningful "below everything" position; blank is a client bug.
        if (body.AnchorItemId is not null && string.IsNullOrWhiteSpace(body.AnchorItemId))
            return Results.BadRequest(new { error = "anchorItemId must be an item id or null." });

        // Records a marker only, so — like reorder — there is no ownership read against the async
        // projection to 404 on projector lag. An anchor that no longer exists resolves on read.
        var version = await handler.HandleAsync(
            new SetTodayLine(currentWorkspace.WorkspaceId, body.AnchorItemId, DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
        var streamId = TodoOrdering.StreamId(currentWorkspace.WorkspaceId);
        return Results.Ok(new { consistencyToken = $"{streamId}@{version}" });
    }
}

public record AddTodoRequest(string Description, string? Priority);

public record EditTodoRequest(string Description);

public record ReorderTodosRequest(IReadOnlyList<string> OrderedItemIds);

public record SetTodayLineRequest(string? AnchorItemId);
