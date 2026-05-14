using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public sealed class TodoListProjection
{
    private readonly Dictionary<NoteId, string> _noteTitles = new();
    private readonly Dictionary<ActionId, (NoteId NoteId, string Description, DateTimeOffset AddedAt, bool Open)> _state = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _noteTitles[e.NoteId] = string.Empty;
                break;
            case NoteRenamed e:
                _noteTitles[e.NoteId] = e.NewTitle;
                break;
            case NoteDeleted e:
                _noteTitles.Remove(e.NoteId);
                foreach (var key in _state.Where(kvp => kvp.Value.NoteId == e.NoteId).Select(kvp => kvp.Key).ToList())
                    _state.Remove(key);
                break;
            case ActionItemAdded e:
                _state[e.ActionId] = (e.NoteId, e.Description, envelope.OccurredAt, Open: true);
                break;
            case ActionItemCompleted e when _state.TryGetValue(e.ActionId, out var comp):
                _state[e.ActionId] = comp with { Open = false };
                break;
            case ActionItemReopened e when _state.TryGetValue(e.ActionId, out var reopen):
                _state[e.ActionId] = reopen with { Open = true };
                break;
            case ActionItemDeleted e:
                _state.Remove(e.ActionId);
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<TodoItem> GetOpenItems() =>
        _state
            .Where(kvp => kvp.Value.Open)
            .Select(kvp => new TodoItem(
                kvp.Key,
                kvp.Value.NoteId,
                _noteTitles.GetValueOrDefault(kvp.Value.NoteId, string.Empty),
                kvp.Value.Description,
                kvp.Value.AddedAt))
            .OrderBy(i => i.AddedAt)
            .ToList()
            .AsReadOnly();
}
