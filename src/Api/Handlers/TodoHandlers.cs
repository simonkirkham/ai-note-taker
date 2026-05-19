using Api.Auth;
using EventStore.Projections;

namespace Api.Handlers;

public static class TodoHandlers
{
    public static async Task<IResult> GetTodos(ITodoListStore store, ICurrentUser currentUser, CancellationToken ct)
    {
        var view = await store.QueryAllAsync(ct).ConfigureAwait(false);
        return Results.Ok(new
        {
            items = view.Items
                .Where(i => i.UserId == currentUser.UserId)
                .Select(i => new
                {
                    actionId = i.ActionId.Value,
                    noteId = i.NoteId.Value,
                    noteTitle = i.NoteTitle,
                    description = i.Description,
                    addedAt = i.AddedAt
                })
        });
    }
}
