using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryNoteCardListStore : INoteCardListStore
{
    private readonly Dictionary<NoteId, NoteCardView> _cards = new();

    public Task UpsertAsync(NoteCardView card, CancellationToken ct = default)
    {
        _cards[card.NoteId] = card;
        return Task.CompletedTask;
    }

    // Field-level writes model DynamoDB's partial UpdateItem: each writer SETs only its own
    // attributes, so a note-field write and an action-item write to the same card commute.
    public Task UpsertNoteFieldsAsync(NoteCardView card, CancellationToken ct = default)
    {
        // Preserve the existing ActionItems (owned by the action writer); seed empty on first write.
        var actionItems = _cards.TryGetValue(card.NoteId, out var existing)
            ? existing.ActionItems
            : Array.Empty<NoteCardActionItem>();
        _cards[card.NoteId] = card with { ActionItems = actionItems };
        return Task.CompletedTask;
    }

    public Task UpdateActionItemsAsync(NoteId noteId, IReadOnlyList<NoteCardActionItem> actionItems, DateTimeOffset lastModifiedAt, CancellationToken ct = default)
    {
        if (_cards.TryGetValue(noteId, out var existing))
            _cards[noteId] = existing with { ActionItems = actionItems, LastModifiedAt = lastModifiedAt };
        return Task.CompletedTask;
    }

    public Task<NoteCardView?> GetByNoteAsync(NoteId noteId, CancellationToken ct = default) =>
        Task.FromResult(_cards.TryGetValue(noteId, out var card) ? card : null);

    public Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<NoteCardView>>(
            _cards.Values.OrderByDescending(c => c.CreatedAt).ToList().AsReadOnly());

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default)
    {
        _cards.Remove(noteId);
        return Task.CompletedTask;
    }
}
