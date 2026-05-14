using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class NoteDetailProjection
{
    private readonly Dictionary<NoteId, NoteDetailView> _items = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _items[e.NoteId] = new NoteDetailView(e.NoteId, string.Empty, string.Empty,
                    envelope.OccurredAt, envelope.OccurredAt);
                break;
            case NoteRenamed e:
                if (_items.TryGetValue(e.NoteId, out var existing))
                    _items[e.NoteId] = existing with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEdited e:
                if (_items.TryGetValue(e.NoteId, out var cur))
                    _items[e.NoteId] = cur with { Content = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEditedV2 e:
                if (_items.TryGetValue(e.NoteId, out var cur2))
                    _items[e.NoteId] = cur2 with { Content = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDateSet e:
                if (_items.TryGetValue(e.NoteId, out var withDate))
                    _items[e.NoteId] = withDate with { Date = e.Date, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteTagged e:
                if (_items.TryGetValue(e.NoteId, out var tagged))
                    _items[e.NoteId] = tagged with { Tags = (tagged.Tags ?? []).Append(e.Tag).ToList().AsReadOnly(), LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteUntagged e:
                if (_items.TryGetValue(e.NoteId, out var untagged))
                    _items[e.NoteId] = untagged with { Tags = (untagged.Tags ?? []).Where(t => t != e.Tag).ToList().AsReadOnly(), LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDeleted e:
                _items.Remove(e.NoteId);
                break;
            default:
                break;
        }
    }

    public NoteDetailView? GetDetail(NoteId noteId) =>
        _items.TryGetValue(noteId, out var detail) ? detail : null;

    public IReadOnlyList<NoteDetailView> GetAllDetails() =>
        new List<NoteDetailView>(_items.Values).AsReadOnly();
}
