using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryTagFeedbackStore : ITagFeedbackStore
{
    private readonly Dictionary<(string UserId, string Tag), (int Suggested, int Rejected)> _aggregates = new();
    private readonly Dictionary<(string NoteId, string Tag), (string UserId, string PromptVersion)> _provenance = new();

    public string? PromptVersionFor(string noteId, string tag) =>
        _provenance.TryGetValue((noteId, tag), out var prov) ? prov.PromptVersion : null;

    public Task RecordSuggestionAsync(string userId, string noteId, string tag, string promptVersion, CancellationToken ct = default)
    {
        var current = _aggregates.GetValueOrDefault((userId, tag));
        _aggregates[(userId, tag)] = (current.Suggested + 1, current.Rejected);
        _provenance[(noteId, tag)] = (userId, promptVersion);
        return Task.CompletedTask;
    }

    public Task<bool> TryRecordRejectionAsync(string noteId, string tag, CancellationToken ct = default)
    {
        if (!_provenance.TryGetValue((noteId, tag), out var prov))
            return Task.FromResult(false);
        var current = _aggregates.GetValueOrDefault((prov.UserId, tag));
        _aggregates[(prov.UserId, tag)] = (current.Suggested, current.Rejected + 1);
        _provenance.Remove((noteId, tag));
        return Task.FromResult(true);
    }

    public Task DeleteProvenanceByNoteAsync(string noteId, CancellationToken ct = default)
    {
        foreach (var key in _provenance.Keys.Where(k => k.NoteId == noteId).ToList())
            _provenance.Remove(key);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<TagFeedbackView>> GetAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<TagFeedbackView>>(
            _aggregates.Select(kv => new TagFeedbackView(kv.Key.UserId, kv.Key.Tag, kv.Value.Suggested, kv.Value.Rejected))
                .ToList().AsReadOnly());

    public Task UpsertAggregateAsync(TagFeedbackView view, CancellationToken ct = default)
    {
        _aggregates[(view.UserId, view.Tag)] = (view.SuggestedCount, view.RejectedCount);
        return Task.CompletedTask;
    }

    public Task PutProvenanceAsync(string noteId, string tag, string userId, string promptVersion, CancellationToken ct = default)
    {
        _provenance[(noteId, tag)] = (userId, promptVersion);
        return Task.CompletedTask;
    }

    public Task DeleteAllAsync(CancellationToken ct = default)
    {
        _aggregates.Clear();
        _provenance.Clear();
        return Task.CompletedTask;
    }
}
