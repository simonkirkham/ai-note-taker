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
                var assignedKey = e.NoteId.Value.ToString("N");
                _workspaceByNote[assignedKey] = e.WorkspaceId.Value;
                // A move assigns the workspace AFTER the note was tagged, so re-stamp any
                // tag rows already emitted for this note — otherwise a rebuild leaves them
                // in the old workspace while the live move re-buckets them (divergence).
                // At create this fires before any tag, so the loop is a no-op.
                for (var i = 0; i < _entries.Count; i++)
                    if (_entries[i].NoteId == assignedKey)
                        _entries[i] = _entries[i] with { WorkspaceId = e.WorkspaceId.Value };
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
