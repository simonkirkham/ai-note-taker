using Domain.Notes;

namespace EventStore.Projections;

public sealed class NoteTitleListProjection
{
    private readonly Dictionary<NoteId, NoteTitleListItem> _items = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _items[e.NoteId] = new NoteTitleListItem(e.NoteId, string.Empty, envelope.OccurredAt, envelope.Metadata.UserId ?? "");
                break;
            case NoteRenamed e:
                if (_items.TryGetValue(e.NoteId, out var existing))
                    _items[e.NoteId] = existing with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDeleted e:
                _items.Remove(e.NoteId);
                break;
            default:
                break;
        }
    }

    public NoteTitleListView GetView() =>
        new(new List<NoteTitleListItem>(_items.Values).AsReadOnly());
}
