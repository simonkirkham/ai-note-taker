using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class NoteActionsProjection
{
    private readonly Dictionary<(NoteId, ActionId), NoteAction> _items = new();
    private readonly Dictionary<ActionId, NoteId> _noteByAction = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case ActionItemAdded e:
                _noteByAction[e.ActionId] = e.NoteId;
                _items[(e.NoteId, e.ActionId)] = new NoteAction(e.ActionId, e.Description, false, envelope.OccurredAt, null);
                break;
            case ActionItemCompleted e when _noteByAction.TryGetValue(e.ActionId, out var noteId):
                _items[(noteId, e.ActionId)] = _items[(noteId, e.ActionId)] with { Completed = true, CompletedAt = e.CompletedAt };
                break;
            case ActionItemReopened e when _noteByAction.TryGetValue(e.ActionId, out var noteId):
                _items[(noteId, e.ActionId)] = _items[(noteId, e.ActionId)] with { Completed = false, CompletedAt = null };
                break;
            case ActionItemEdited e when _noteByAction.TryGetValue(e.ActionId, out var noteId):
                _items[(noteId, e.ActionId)] = _items[(noteId, e.ActionId)] with { Description = e.NewDescription };
                break;
            case ActionItemDeleted e when _noteByAction.TryGetValue(e.ActionId, out var noteId):
                _items.Remove((noteId, e.ActionId));
                _noteByAction.Remove(e.ActionId);
                break;
        }
    }

    public NoteActionsView GetView(NoteId noteId)
    {
        var actions = _items
            .Where(kvp => kvp.Key.Item1 == noteId)
            .OrderBy(kvp => kvp.Value.AddedAt)
            .Select(kvp => kvp.Value)
            .ToList()
            .AsReadOnly();
        return new NoteActionsView(noteId, actions);
    }
}
