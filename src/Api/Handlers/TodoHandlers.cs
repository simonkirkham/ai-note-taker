using EventStore.Projections;
using Microsoft.AspNetCore.Http;

namespace Api.Handlers;

public static class TodoHandlers
{
    public static async Task<IResult> GetTodos(ITodoListStore store, CancellationToken ct)
    {
        var view = await store.QueryAllAsync(ct).ConfigureAwait(false);
        return Results.Ok(new
        {
            items = view.Items.Select(i => new
            {
                actionId    = i.ActionId.Value,
                noteId      = i.NoteId.Value,
                noteTitle   = i.NoteTitle,
                description = i.Description,
                addedAt     = i.AddedAt
            })
        });
    }
}
