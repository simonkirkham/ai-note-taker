using Domain.Notes;

namespace EventStore.Projections;

public sealed class TagIndexProjection
{
    private readonly List<TagIndexView> _entries = new();
    // Tag rows inherit their note's workspace, which is carried by the note's
    // NoteAssignedToWorkspace event (emitted at create, ahead of any tag in stream order).
    private readonly Dictionary<string, string> _workspaceByNote = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteAssignedToWorkspace e:
                _workspaceByNote[e.NoteId.Value.ToString("N")] = e.WorkspaceId.Value;
                break;
            case NoteTagged e:
                var noteKey = e.NoteId.Value.ToString("N");
                _entries.Add(new TagIndexView(e.Tag, noteKey, envelope.Metadata.UserId ?? "",
                    _workspaceByNote.GetValueOrDefault(noteKey)));
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
