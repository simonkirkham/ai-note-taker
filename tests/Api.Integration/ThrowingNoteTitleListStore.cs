using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

// Throws on read so GET /notes surfaces an unhandled exception. ListNotes has
// no try/catch, so this reaches the global 500 handler unmodified — unlike the
// command endpoints, which map InvalidOperationException to 4xx.
internal sealed class ThrowingNoteTitleListStore : INoteTitleListStore
{
    public Task UpsertAsync(NoteTitleListItem item, CancellationToken ct = default) => Task.CompletedTask;

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default) => Task.CompletedTask;

    public Task DeleteAllAsync(CancellationToken ct = default) => Task.CompletedTask;

    public Task<NoteTitleListView> QueryAllAsync(CancellationToken ct = default)
        => throw new InvalidOperationException("Simulated projection store failure");
}
