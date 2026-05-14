namespace EventStore.Projections;

public interface ITagIndexStore
{
    Task PutAsync(string tag, string noteId, CancellationToken ct = default);
    Task DeleteAsync(string tag, string noteId, CancellationToken ct = default);
    Task DeleteByNoteAsync(string noteId, CancellationToken ct = default);
    Task<IReadOnlyList<TagIndexView>> GetAllAsync(CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
}
