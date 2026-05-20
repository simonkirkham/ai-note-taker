using Api.Auth;
using Api.CommandHandlers;
using Domain.Todos;
using EventStore.Projections;

namespace Api.Handlers;

public static class TodoHandlers
{
    public static async Task<IResult> GetTodos(ITodoListStore store, ICurrentUser currentUser, CancellationToken ct)
    {
        var view = await store.QueryAllAsync(ct).ConfigureAwait(false);
        // Extend cutoff to 2 days back so any UTC-offset "today" is covered;
        // the frontend applies its own local-calendar-day filter.
        var cutoff = DateTimeOffset.UtcNow.Date.AddDays(-1);

        return Results.Ok(new
        {
            items = view.Items
                .Where(i => i.UserId == currentUser.UserId)
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
        await handler.HandleAsync(new AddTodo(todoId, currentUser.UserId, body.Description.Trim(), body.Priority), ct).ConfigureAwait(false);
        return Results.Ok(new { todoId = todoId.Value });
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
}

public record AddTodoRequest(string Description, string? Priority);
