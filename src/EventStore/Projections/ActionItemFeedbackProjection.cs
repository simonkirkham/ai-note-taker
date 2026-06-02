using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class ActionItemFeedbackProjection
{
    private readonly Dictionary<string, string> _provenance = new();
    private readonly List<string> _deleted = new();
    private readonly List<string> _completed = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case ActionItemsSuggested e:
                foreach (var id in e.ActionItemIds)
                    _provenance[id.ToString()] = envelope.Metadata.UserId ?? "";
                break;
            case ActionItemDeleted e:
                _deleted.Add(e.ActionId.Value.ToString());
                break;
            case ActionItemCompleted e:
                _completed.Add(e.ActionId.Value.ToString());
                break;
            default:
                break;
        }
    }

    // Counts are computed here rather than incrementally: the suggestion event lives on the note
    // stream and the deletion/completion events on the action streams, so a rebuild (ordered by
    // stream id) may replay a deletion before its suggestion. Deferring keeps counts order-independent.
    public IReadOnlyList<ActionItemFeedbackView> GetAggregates()
    {
        return _provenance.Values.Distinct()
            .Select(user =>
            {
                var ids = _provenance.Where(kv => kv.Value == user).Select(kv => kv.Key).ToHashSet();
                return new ActionItemFeedbackView(
                    user,
                    ids.Count,
                    _deleted.Count(ids.Contains),
                    _completed.Count(ids.Contains));
            })
            .ToList().AsReadOnly();
    }

    public IReadOnlyList<ActionItemFeedbackProvenance> GetProvenance() =>
        _provenance.Select(kv => new ActionItemFeedbackProvenance(kv.Key, kv.Value)).ToList().AsReadOnly();
}
