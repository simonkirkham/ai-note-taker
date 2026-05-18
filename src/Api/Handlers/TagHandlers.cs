using EventStore.Projections;

namespace Api.Handlers;

public static class TagHandlers
{
    public static async Task<IResult> GetTags(ITagIndexStore tagIndexStore, CancellationToken ct)
    {
        var all = await tagIndexStore.GetAllAsync(ct).ConfigureAwait(false);
        var tags = all
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
