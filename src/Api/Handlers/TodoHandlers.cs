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
        var todayUtc = DateTimeOffset.UtcNow.Date;

        return Results.Ok(new
        {
            items = view.Items
                .Where(i => i.UserId == currentUser.UserId)
                .Where(i => i.CompletedAt is null || i.CompletedAt.Value.UtcDateTime.Date >= todayUtc)
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
        var todoId = new TodoId(Guid.NewGuid());
        await handler.HandleAsync(new AddTodo(todoId, currentUser.UserId, body.Description, body.Priority), ct).ConfigureAwait(false);
        return Results.Ok(new { todoId = todoId.Value });
    }

    public static async Task<IResult> CompleteTodo(
        Guid todoId,
        ITodoCommandHandler handler,
        CancellationToken ct)
    {
        await handler.HandleAsync(new CompleteTodo(new TodoId(todoId), DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
        return Results.NoContent();
    }

    public static async Task<IResult> ReopenTodo(
        Guid todoId,
        ITodoCommandHandler handler,
        CancellationToken ct)
    {
        await handler.HandleAsync(new ReopenTodo(new TodoId(todoId), DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
        return Results.NoContent();
    }

    public static async Task<IResult> DeleteTodo(
        Guid todoId,
        ITodoCommandHandler handler,
        CancellationToken ct)
    {
        await handler.HandleAsync(new DeleteTodo(new TodoId(todoId), DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
        return Results.NoContent();
    }
}

public record AddTodoRequest(string Description, string? Priority);
