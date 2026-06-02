namespace EventStore.Projections;

public interface ITagFeedbackStore
{
    Task RecordSuggestionAsync(string userId, string noteId, string tag, CancellationToken ct = default);
    Task<bool> TryRecordRejectionAsync(string noteId, string tag, CancellationToken ct = default);
    Task DeleteProvenanceByNoteAsync(string noteId, CancellationToken ct = default);
    Task<IReadOnlyList<TagFeedbackView>> GetAllAsync(CancellationToken ct = default);
    Task UpsertAggregateAsync(TagFeedbackView view, CancellationToken ct = default);
    Task PutProvenanceAsync(string noteId, string tag, string userId, CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
}
