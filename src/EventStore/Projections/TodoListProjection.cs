using Domain.ActionItems;
using Domain.Notes;
using Domain.Todos;

namespace EventStore.Projections;

public sealed class TodoListProjection
{
    private readonly Dictionary<NoteId, string> _noteTitles = new();
    // Action-item rows inherit their note's workspace (carried by NoteAssignedToWorkspace,
    // ahead of any action item in stream order); standalone todos use the write's metadata.
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
            case TodoDeleted e:
                _state.Remove(e.TodoId.Value.ToString());
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
                kvp.Value.WorkspaceId))
            .OrderBy(i => i.AddedAt)
            .ToList()
            .AsReadOnly();
}
