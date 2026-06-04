using Domain.Notes;

namespace EventStore.Projections;

public sealed class TagFeedbackProjection
{
    // v1 TagsSuggested events carry no prompt provenance; their rows record "unknown" so a rebuild over
    // a pre-10-M stream is stable and the prompt-version slice has a defined value rather than null.
    public const string UnknownPromptVersion = "unknown";

    private readonly Dictionary<(string UserId, string Tag), (int Suggested, int Rejected)> _aggregates = new();
    private readonly Dictionary<(string NoteId, string Tag), (string UserId, string PromptVersion)> _provenance = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case TagsSuggestedV2 e:
                RecordSuggestions(NoteIdKey(e.NoteId), envelope.Metadata.UserId ?? "", e.Tags, e.PromptVersion);
                break;
            case TagsSuggested e:
                RecordSuggestions(NoteIdKey(e.NoteId), envelope.Metadata.UserId ?? "", e.Tags, UnknownPromptVersion);
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
        _provenance.Select(kv => new TagFeedbackProvenance(kv.Key.NoteId, kv.Key.Tag, kv.Value.UserId, kv.Value.PromptVersion))
            .ToList().AsReadOnly();

    private void RecordSuggestions(string noteId, string userId, IReadOnlyList<string> tags, string promptVersion)
    {
        foreach (var tag in tags)
        {
            var current = _aggregates.GetValueOrDefault((userId, tag));
            _aggregates[(userId, tag)] = (current.Suggested + 1, current.Rejected);
            _provenance[(noteId, tag)] = (userId, promptVersion);
        }
    }

    private void RecordRejection(string noteId, string tag)
    {
        if (!_provenance.TryGetValue((noteId, tag), out var prov))
            return;
        var current = _aggregates.GetValueOrDefault((prov.UserId, tag));
        _aggregates[(prov.UserId, tag)] = (current.Suggested, current.Rejected + 1);
        _provenance.Remove((noteId, tag));
    }

    private void RemoveProvenanceForNote(string noteId)
    {
        foreach (var key in _provenance.Keys.Where(k => k.NoteId == noteId).ToList())
            _provenance.Remove(key);
    }

    private static string NoteIdKey(NoteId noteId) => noteId.Value.ToString("N");
}
