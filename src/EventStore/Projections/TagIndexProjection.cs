using Domain.Notes;

namespace EventStore.Projections;

public sealed class TagIndexProjection
{
    private readonly List<TagIndexView> _entries = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteTagged e:
                _entries.Add(new TagIndexView(e.Tag, e.NoteId.Value.ToString("N")));
                break;
            case NoteUntagged e:
                _entries.RemoveAll(x => x.Tag == e.Tag && x.NoteId == e.NoteId.Value.ToString("N"));
                break;
            case NoteDeleted e:
                _entries.RemoveAll(x => x.NoteId == e.NoteId.Value.ToString("N"));
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<TagIndexView> GetAll() => _entries.AsReadOnly();
}
