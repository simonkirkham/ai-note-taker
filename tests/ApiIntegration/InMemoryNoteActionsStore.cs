using Domain.ActionItems;
using Domain.Notes;
using EventStore.Projections;

namespace ApiIntegration;

internal sealed class InMemoryNoteActionsStore : INoteActionsStore
{
    private readonly Dictionary<(NoteId, ActionId), NoteAction> _items = new();

    public Task UpsertAsync(NoteId noteId, NoteAction item, CancellationToken ct = default)
    {
        _items[(noteId, item.ActionId)] = item;
        return Task.CompletedTask;
    }

    public Task<NoteActionsView> QueryByNoteAsync(NoteId noteId, CancellationToken ct = default)
    {
        var actions = _items
            .Where(kvp => kvp.Key.Item1 == noteId)
            .OrderBy(kvp => kvp.Value.AddedAt)
            .Select(kvp => kvp.Value)
            .ToList()
            .AsReadOnly();
        return Task.FromResult(new NoteActionsView(noteId, actions));
    }
}
