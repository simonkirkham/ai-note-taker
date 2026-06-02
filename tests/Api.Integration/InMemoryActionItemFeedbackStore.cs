using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryActionItemFeedbackStore : IActionItemFeedbackStore
{
    private readonly Dictionary<string, (int Suggested, int Deleted, int Completed)> _aggregates = new();
    private readonly Dictionary<string, string> _provenance = new();

    public Task RecordSuggestionAsync(string userId, string actionItemId, CancellationToken ct = default)
    {
        var current = _aggregates.GetValueOrDefault(userId);
        _aggregates[userId] = (current.Suggested + 1, current.Deleted, current.Completed);
        _provenance[actionItemId] = userId;
        return Task.CompletedTask;
    }

    public Task<bool> TryRecordDeletionAsync(string actionItemId, CancellationToken ct = default)
    {
        if (!_provenance.TryGetValue(actionItemId, out var userId)) return Task.FromResult(false);
        var c = _aggregates.GetValueOrDefault(userId);
        _aggregates[userId] = (c.Suggested, c.Deleted + 1, c.Completed);
        return Task.FromResult(true);
    }

    public Task<bool> TryRecordCompletionAsync(string actionItemId, CancellationToken ct = default)
    {
        if (!_provenance.TryGetValue(actionItemId, out var userId)) return Task.FromResult(false);
        var c = _aggregates.GetValueOrDefault(userId);
        _aggregates[userId] = (c.Suggested, c.Deleted, c.Completed + 1);
        return Task.FromResult(true);
    }

    public Task<IReadOnlyList<ActionItemFeedbackView>> GetAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<ActionItemFeedbackView>>(
            _aggregates.Select(kv => new ActionItemFeedbackView(kv.Key, kv.Value.Suggested, kv.Value.Deleted, kv.Value.Completed))
                .ToList().AsReadOnly());

    public Task UpsertAggregateAsync(ActionItemFeedbackView view, CancellationToken ct = default)
    {
        _aggregates[view.UserId] = (view.SuggestedCount, view.DeletedCount, view.CompletedCount);
        return Task.CompletedTask;
    }

    public Task PutProvenanceAsync(string actionItemId, string userId, CancellationToken ct = default)
    {
        _provenance[actionItemId] = userId;
        return Task.CompletedTask;
    }

    public Task DeleteAllAsync(CancellationToken ct = default)
    {
        _aggregates.Clear();
        _provenance.Clear();
        return Task.CompletedTask;
    }
}
