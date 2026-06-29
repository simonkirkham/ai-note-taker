using Api.Auth;
using EventStore.Projections;

namespace Api.Handlers;

public static class TagHandlers
{
    public static async Task<IResult> GetTags(ITagIndexStore tagIndexStore, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, CancellationToken ct)
    {
        var all = await tagIndexStore.GetAllAsync(ct).ConfigureAwait(false);
        var tags = all
            .Where(x => x.UserId == currentUser.UserId && currentWorkspace.Includes(x.WorkspaceId))
            .GroupBy(x => x.Tag)
            .Select(g => new
            {
                tag = g.Key,
                noteCount = g.Count(),
                noteIds = g.Select(x => x.NoteId).ToList()
            })
            .OrderByDescending(x => x.noteCount)
            .ToList();

        return Results.Ok(new { tags });
    }
}
