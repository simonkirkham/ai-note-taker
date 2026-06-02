using Domain.Notes;

namespace EventStore.Projections;

public sealed class TagFeedbackProjection
{
    private readonly Dictionary<(string UserId, string Tag), (int Suggested, int Rejected)> _aggregates = new();
    private readonly Dictionary<(string NoteId, string Tag), string> _provenance = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case TagsSuggested e:
                RecordSuggestions(NoteIdKey(e.NoteId), envelope.Metadata.UserId ?? "", e.Tags);
                break;
            case NoteUntagged e:
                RecordRejection(NoteIdKey(e.NoteId), e.Tag);
                break;
            case NoteDeleted e:
                RemoveProvenanceForNote(NoteIdKey(e.NoteId));
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<TagFeedbackView> GetAggregates() =>
        _aggregates.Select(kv => new TagFeedbackView(kv.Key.UserId, kv.Key.Tag, kv.Value.Suggested, kv.Value.Rejected))
            .ToList().AsReadOnly();

    public IReadOnlyList<TagFeedbackProvenance> GetProvenance() =>
        _provenance.Select(kv => new TagFeedbackProvenance(kv.Key.NoteId, kv.Key.Tag, kv.Value))
            .ToList().AsReadOnly();

    private void RecordSuggestions(string noteId, string userId, IReadOnlyList<string> tags)
    {
        foreach (var tag in tags)
        {
            var current = _aggregates.GetValueOrDefault((userId, tag));
            _aggregates[(userId, tag)] = (current.Suggested + 1, current.Rejected);
            _provenance[(noteId, tag)] = userId;
        }
    }

    private void RecordRejection(string noteId, string tag)
    {
        if (!_provenance.TryGetValue((noteId, tag), out var userId))
            return;
        var current = _aggregates.GetValueOrDefault((userId, tag));
        _aggregates[(userId, tag)] = (current.Suggested, current.Rejected + 1);
        _provenance.Remove((noteId, tag));
    }

    private void RemoveProvenanceForNote(string noteId)
    {
        foreach (var key in _provenance.Keys.Where(k => k.NoteId == noteId).ToList())
            _provenance.Remove(key);
    }

    private static string NoteIdKey(NoteId noteId) => noteId.Value.ToString("N");
}
