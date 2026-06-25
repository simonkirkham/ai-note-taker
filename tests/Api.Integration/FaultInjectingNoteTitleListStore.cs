using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

// Wraps an in-memory title-list store but throws a simulated cold-table throttle on the
// next Upsert when armed — used to prove the rebuild retries past a transient write fault.
public sealed class FaultInjectingNoteTitleListStore : INoteTitleListStore
{
    private readonly InMemoryNoteTitleListStore _inner = new();

    public bool FailNextUpsert { get; set; }

    public Task UpsertAsync(NoteTitleListItem item, CancellationToken ct = default)
    {
        if (FailNextUpsert)
        {
            FailNextUpsert = false;
            throw new Amazon.DynamoDBv2.Model.ProvisionedThroughputExceededException("simulated cold-table throttle");
        }
        return _inner.UpsertAsync(item, ct);
    }

    public Task DeleteAsync(NoteId noteId, CancellationToken ct = default) => _inner.DeleteAsync(noteId, ct);
    public Task DeleteAllAsync(CancellationToken ct = default) => _inner.DeleteAllAsync(ct);
    public Task<NoteTitleListView> QueryAllAsync(CancellationToken ct = default) => _inner.QueryAllAsync(ct);
}
