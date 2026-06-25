using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryTranscriptionDraftStore : ITranscriptionDraftStore
{
    private readonly Dictionary<NoteId, TranscriptionDraft> _items = new();

    public Task SaveAsync(TranscriptionDraft draft, CancellationToken ct = default)
    {
        _items[draft.NoteId] = draft;
        return Task.CompletedTask;
    }

    public Task<TranscriptionDraft?> GetAsync(NoteId noteId, CancellationToken ct = default) =>
        Task.FromResult(_items.TryGetValue(noteId, out var draft) ? draft : null);

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default)
    {
        _items.Remove(noteId);
        return Task.CompletedTask;
    }
}
