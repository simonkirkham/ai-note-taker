using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryTagIndexStore : ITagIndexStore
{
    private readonly List<TagIndexView> _entries = new();

    public Task PutAsync(string tag, string noteId, string userId, string? workspaceId, CancellationToken ct = default)
    {
        _entries.RemoveAll(x => x.Tag == tag && x.NoteId == noteId);
        _entries.Add(new TagIndexView(tag, noteId, userId, workspaceId));
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string tag, string noteId, CancellationToken ct = default)
    {
        _entries.RemoveAll(x => x.Tag == tag && x.NoteId == noteId);
        return Task.CompletedTask;
    }

    public Task DeleteByNoteAsync(string noteId, CancellationToken ct = default)
    {
        _entries.RemoveAll(x => x.NoteId == noteId);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<TagIndexView>> GetAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<TagIndexView>>(_entries.ToList().AsReadOnly());

    public Task DeleteAllAsync(CancellationToken ct = default)
    {
        _entries.Clear();
        return Task.CompletedTask;
    }
}
