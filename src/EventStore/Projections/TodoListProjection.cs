using Domain.ActionItems;
using Domain.Notes;
using Domain.Todos;

namespace EventStore.Projections;

public sealed class TodoListProjection
{
    private readonly Dictionary<NoteId, string> _noteTitles = new();
    // Explicit per-item position from the latest TodoListReordered snapshot (keyed by item id;
    // item ids are globally unique across todos and action items). Items absent from any snapshot
    // sort after positioned ones by AddedAt.
    private readonly Dictionary<string, int> _positions = new();
    // Action-item rows inherit their note's workspace (from the note's NoteAssignedToWorkspace);
    // standalone todos use the write's metadata. On rebuild, ReadAllStreamsAsync orders by
    // StreamId, so an `action#…` stream is replayed BEFORE its `note#…` stream — the map is
    // empty when ActionItemAdded lands. The NoteAssignedToWorkspace arm below therefore
    // back-fills any already-seen action rows for the note; that back-fill (not map ordering)
    // is what makes rebuild correct, so do not remove it.
    private readonly Dictionary<string, string> _workspaceByNote = new();
    private readonly Dictionary<string, (string? NoteId, string? NoteTitle, string Type, string Description, DateTimeOffset AddedAt, DateTimeOffset? CompletedAt, string UserId, string? WorkspaceId)> _state = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case NoteCreated e:
                _noteTitles[e.NoteId] = string.Empty;
                break;
            case NoteRenamed e:
                _noteTitles[e.NoteId] = e.NewTitle;
                foreach (var key in _state.Where(kvp => kvp.Value.NoteId == e.NoteId.Value.ToString()).Select(kvp => kvp.Key).ToList())
                    _state[key] = _state[key] with { NoteTitle = e.NewTitle };
                break;
            case NoteDeleted e:
                _noteTitles.Remove(e.NoteId);
                foreach (var key in _state.Where(kvp => kvp.Value.NoteId == e.NoteId.Value.ToString()).Select(kvp => kvp.Key).ToList())
                    _state.Remove(key);
                break;
            case NoteAssignedToWorkspace e:
                _workspaceByNote[e.NoteId.Value.ToString()] = e.WorkspaceId.Value;
                foreach (var key in _state.Where(kvp => kvp.Value.NoteId == e.NoteId.Value.ToString()).Select(kvp => kvp.Key).ToList())
                    _state[key] = _state[key] with { WorkspaceId = e.WorkspaceId.Value };
                break;
            case ActionItemAdded e:
                _state[e.ActionId.Value.ToString()] = (
                    e.NoteId.Value.ToString(),
                    _noteTitles.GetValueOrDefault(e.NoteId, string.Empty),
                    "action",
                    e.Description,
                    envelope.OccurredAt,
                    null,
                    envelope.Metadata.UserId ?? string.Empty,
                    _workspaceByNote.GetValueOrDefault(e.NoteId.Value.ToString()));
                break;
            case ActionItemCompleted e when _state.TryGetValue(e.ActionId.Value.ToString(), out var comp):
                _state[e.ActionId.Value.ToString()] = comp with { CompletedAt = e.CompletedAt };
                break;
            case ActionItemReopened e when _state.TryGetValue(e.ActionId.Value.ToString(), out var reopen):
                _state[e.ActionId.Value.ToString()] = reopen with { CompletedAt = null };
                break;
            case ActionItemEdited e when _state.TryGetValue(e.ActionId.Value.ToString(), out var edited):
                _state[e.ActionId.Value.ToString()] = edited with { Description = e.NewDescription };
                break;
            case ActionItemDeleted e:
                _state.Remove(e.ActionId.Value.ToString());
                break;
            case TodoAdded e:
                _state[e.TodoId.Value.ToString()] = (null, null, "todo", e.Description, envelope.OccurredAt, null, envelope.Metadata.UserId ?? e.UserId, envelope.Metadata.WorkspaceId);
                break;
            case TodoCompleted e when _state.TryGetValue(e.TodoId.Value.ToString(), out var tc):
                _state[e.TodoId.Value.ToString()] = tc with { CompletedAt = e.CompletedAt };
                break;
            case TodoReopened e when _state.TryGetValue(e.TodoId.Value.ToString(), out var tr):
                _state[e.TodoId.Value.ToString()] = tr with { CompletedAt = null };
                break;
            case TodoEdited e when _state.TryGetValue(e.TodoId.Value.ToString(), out var ted):
                _state[e.TodoId.Value.ToString()] = ted with { Description = e.NewDescription };
                break;
            case TodoDeleted e:
                _state.Remove(e.TodoId.Value.ToString());
                break;
            case TodoListReordered e:
                for (var i = 0; i < e.OrderedItemIds.Count; i++)
                    _positions[e.OrderedItemIds[i]] = i;
                break;
        }
    }

    public IReadOnlyList<TodoItem> GetAllItems() =>
        _state
            .Select(kvp => new TodoItem(
                kvp.Key,
                kvp.Value.NoteId,
                kvp.Value.NoteTitle,
                kvp.Value.Type,
                kvp.Value.Description,
                kvp.Value.AddedAt,
                kvp.Value.CompletedAt,
                kvp.Value.UserId,
                kvp.Value.WorkspaceId,
                _positions.TryGetValue(kvp.Key, out var pos) ? pos : null))
            .OrderBy(i => i.Position ?? int.MaxValue)
            .ThenBy(i => i.AddedAt)
            .ToList()
            .AsReadOnly();
}
