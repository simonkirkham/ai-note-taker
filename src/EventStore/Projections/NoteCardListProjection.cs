using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class NoteCardListProjection
{
    public const int MaxStoredContentLength = 200;

    private readonly Dictionary<NoteId, NoteCardView> _cards = new();
    private readonly Dictionary<ActionId, NoteId> _noteByAction = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _cards[e.NoteId] = new NoteCardView(e.NoteId, string.Empty, string.Empty,
                    Array.Empty<NoteCardActionItem>(), null,
                    envelope.OccurredAt, envelope.OccurredAt, false,
                    UserId: envelope.Metadata.UserId ?? "");
                break;
            case NoteRenamed e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                break;
            case ContentEditedV2 e when _cards.TryGetValue(e.NoteId, out var c):
                var trimmed = e.NewContent.Length > MaxStoredContentLength ? e.NewContent[..MaxStoredContentLength] : e.NewContent;
                _cards[e.NoteId] = c with { Content = trimmed, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDateSet e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { Date = e.Date, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteDeleted e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { Deleted = true, LastModifiedAt = envelope.OccurredAt };
                break;
            case ActionItemAdded e when _cards.TryGetValue(e.NoteId, out var c):
                _noteByAction[e.ActionId] = e.NoteId;
                _cards[e.NoteId] = c with
                {
                    ActionItems = c.ActionItems.Append(new NoteCardActionItem(e.ActionId, e.Description, false))
                        .ToList().AsReadOnly(),
                    LastModifiedAt = envelope.OccurredAt
                };
                break;
            case ActionItemCompleted e when _noteByAction.TryGetValue(e.ActionId, out var noteId)
                && _cards.TryGetValue(noteId, out var cc):
                _cards[noteId] = cc with
                {
                    ActionItems = cc.ActionItems
                        .Select(a => a.ActionId == e.ActionId ? a with { Completed = true } : a)
                        .ToList().AsReadOnly(),
                    LastModifiedAt = envelope.OccurredAt
                };
                break;
            case ActionItemReopened e when _noteByAction.TryGetValue(e.ActionId, out var noteId)
                && _cards.TryGetValue(noteId, out var rc):
                _cards[noteId] = rc with
                {
                    ActionItems = rc.ActionItems
                        .Select(a => a.ActionId == e.ActionId ? a with { Completed = false } : a)
                        .ToList().AsReadOnly(),
                    LastModifiedAt = envelope.OccurredAt
                };
                break;
            case ActionItemEdited e when _noteByAction.TryGetValue(e.ActionId, out var noteId)
                && _cards.TryGetValue(noteId, out var ec):
                _cards[noteId] = ec with
                {
                    ActionItems = ec.ActionItems
                        .Select(a => a.ActionId == e.ActionId ? a with { Description = e.NewDescription } : a)
                        .ToList().AsReadOnly(),
                    LastModifiedAt = envelope.OccurredAt
                };
                break;
            case ActionItemDeleted e when _noteByAction.TryGetValue(e.ActionId, out var noteId)
                && _cards.TryGetValue(noteId, out var dc):
                _noteByAction.Remove(e.ActionId);
                _cards[noteId] = dc with
                {
                    ActionItems = dc.ActionItems
                        .Where(a => a.ActionId != e.ActionId)
                        .ToList().AsReadOnly(),
                    LastModifiedAt = envelope.OccurredAt
                };
                break;
            case NoteTagged e when _cards.TryGetValue(e.NoteId, out var c):
                // Lowercase + dedupe on fold (CHANGE-17) so legacy mixed-case events
                // ("Foo" then "foo") collapse to one tag on rebuild.
                var addTag = TagNormalization.Normalize(e.Tag);
                var withTag = (c.Tags ?? []).Contains(addTag) ? (c.Tags ?? []) : (c.Tags ?? []).Append(addTag).ToList().AsReadOnly();
                _cards[e.NoteId] = c with { Tags = withTag, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteUntagged e when _cards.TryGetValue(e.NoteId, out var c):
                var removeTag = TagNormalization.Normalize(e.Tag);
                _cards[e.NoteId] = c with { Tags = (c.Tags ?? []).Where(t => t != removeTag).ToList().AsReadOnly(), LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteFiledInFolder e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { FolderId = e.FolderId, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteUnfiled e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { FolderId = null, LastModifiedAt = envelope.OccurredAt };
                break;
            case NoteAssignedToWorkspace e when _cards.TryGetValue(e.NoteId, out var c):
                _cards[e.NoteId] = c with { WorkspaceId = e.WorkspaceId.Value };
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<NoteCardView> GetAll() =>
        _cards.Values
            .OrderByDescending(c => c.CreatedAt)
            .ToList()
            .AsReadOnly();
}
