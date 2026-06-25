using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class NoteSearchViewProjection
{
    private readonly Dictionary<NoteId, NoteSearchView> _items = new();
    private readonly Dictionary<NoteId, Dictionary<ActionId, string>> _actionsByNote = new();
    private readonly Dictionary<ActionId, NoteId> _noteByAction = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _items[e.NoteId] = new NoteSearchView(e.NoteId, envelope.Metadata.UserId ?? "",
                    string.Empty, string.Empty, string.Empty, Array.Empty<string>(), string.Empty,
                    false, envelope.OccurredAt);
                _actionsByNote[e.NoteId] = new Dictionary<ActionId, string>();
                break;
            case NoteRenamed e when _items.TryGetValue(e.NoteId, out var c):
                _items[e.NoteId] = c with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEdited e when _items.TryGetValue(e.NoteId, out var c):
                _items[e.NoteId] = c with { Body = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEditedV2 e when _items.TryGetValue(e.NoteId, out var c):
                _items[e.NoteId] = c with { Body = e.NewContent, LastModifiedAt = envelope.OccurredAt };
                break;
            case AnalysisSummaryRecorded e when _items.TryGetValue(e.NoteId, out var c):
                _items[e.NoteId] = c with { FinalNotesText = ComposeFinalNotes(e), LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteTagged e when _items.TryGetValue(e.NoteId, out var c):
                // Lowercase + dedupe on fold (CHANGE-17) so legacy mixed-case tags normalise on
                // rebuild and a lowercase search token still matches.
                var addTag = TagNormalization.Normalize(e.Tag);
                var withTag = c.Tags.Contains(addTag) ? c.Tags : c.Tags.Append(addTag).ToList().AsReadOnly();
                _items[e.NoteId] = c with { Tags = withTag, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteUntagged e when _items.TryGetValue(e.NoteId, out var c):
                var removeTag = TagNormalization.Normalize(e.Tag);
                _items[e.NoteId] = c with { Tags = c.Tags.Where(t => t != removeTag).ToList().AsReadOnly(), LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDeleted e when _items.TryGetValue(e.NoteId, out var c):
                _items[e.NoteId] = c with { Deleted = true, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteAssignedToWorkspace e when _items.TryGetValue(e.NoteId, out var c):
                _items[e.NoteId] = c with { WorkspaceId = e.WorkspaceId.Value };
                break;
            case ActionItemAdded e when _items.TryGetValue(e.NoteId, out var c):
                _noteByAction[e.ActionId] = e.NoteId;
                Actions(e.NoteId)[e.ActionId] = e.Description;
                _items[e.NoteId] = c with { ActionItemsText = ComposeActions(e.NoteId), LastModifiedAt = envelope.OccurredAt };
                break;
            case ActionItemEdited e when _noteByAction.TryGetValue(e.ActionId, out var noteId) && _items.TryGetValue(noteId, out var c):
                Actions(noteId)[e.ActionId] = e.NewDescription;
                _items[noteId] = c with { ActionItemsText = ComposeActions(noteId), LastModifiedAt = envelope.OccurredAt };
                break;
            case ActionItemDeleted e when _noteByAction.TryGetValue(e.ActionId, out var noteId) && _items.TryGetValue(noteId, out var c):
                _noteByAction.Remove(e.ActionId);
                Actions(noteId).Remove(e.ActionId);
                _items[noteId] = c with { ActionItemsText = ComposeActions(noteId), LastModifiedAt = envelope.OccurredAt };
                break;
            default:
                break;
        }
    }

    private Dictionary<ActionId, string> Actions(NoteId noteId)
    {
        if (!_actionsByNote.TryGetValue(noteId, out var actions))
        {
            actions = new Dictionary<ActionId, string>();
            _actionsByNote[noteId] = actions;
        }
        return actions;
    }

    private string ComposeActions(NoteId noteId) =>
        string.Join(" ", Actions(noteId).Values);

    private static string ComposeFinalNotes(AnalysisSummaryRecorded e) =>
        string.Join(" ", new[] { e.Summary }
            .Concat(e.DiscussionPoints)
            .Concat(e.Decisions)
            .Where(s => !string.IsNullOrWhiteSpace(s)));

    public IReadOnlyList<NoteSearchView> GetAll() =>
        _items.Values.ToList().AsReadOnly();
}
