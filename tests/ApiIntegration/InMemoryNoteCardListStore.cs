using Domain.Notes;
using EventStore.Projections;

namespace ApiIntegration;

internal sealed class InMemoryNoteCardListStore : INoteCardListStore
{
    private readonly Dictionary<NoteId, NoteCardView> _cards = new();

    public Task UpsertAsync(NoteCardView card, CancellationToken ct = default)
    {
        _cards[card.NoteId] = card;
        return Task.CompletedTask;
    }

    public Task<NoteCardView?> GetByNoteAsync(NoteId noteId, CancellationToken ct = default) =>
        Task.FromResult(_cards.TryGetValue(noteId, out var card) ? card : null);

    public Task<IReadOnlyList<NoteCardView>> QueryAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<NoteCardView>>(
            _cards.Values.OrderByDescending(c => c.CreatedAt).ToList().AsReadOnly());
}
