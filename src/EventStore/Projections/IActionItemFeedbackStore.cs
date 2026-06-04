namespace EventStore.Projections;

public interface IActionItemFeedbackStore
{
    Task RecordSuggestionAsync(string userId, string actionItemId, string promptVersion, CancellationToken ct = default);
    Task<bool> TryRecordDeletionAsync(string actionItemId, CancellationToken ct = default);
    Task<bool> TryRecordCompletionAsync(string actionItemId, CancellationToken ct = default);
    Task<IReadOnlyList<ActionItemFeedbackView>> GetAllAsync(CancellationToken ct = default);
    Task UpsertAggregateAsync(ActionItemFeedbackView view, CancellationToken ct = default);
    Task PutProvenanceAsync(string actionItemId, string userId, string promptVersion, CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
}
