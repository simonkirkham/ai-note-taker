namespace EventStore.Projections;

// Per-stream high-water mark of the highest event sequence the projector has applied.
// The async projector reads it before applying a stream's records and skips any at or
// below it, so a redelivered stream record never re-runs a non-idempotent apply (the
// increment-based feedback counters in particular). A get of an unseen stream returns -1
// so sequence 0/1 is always "not yet applied".
public interface IProcessedPositionStore
{
    Task<long> GetLastSeqAsync(string streamId, CancellationToken ct = default);

    // Advances the mark to seq. Never regresses: a concurrent or redelivered batch that
    // computed a lower max is a no-op.
    Task SetLastSeqAsync(string streamId, long seq, CancellationToken ct = default);
}
