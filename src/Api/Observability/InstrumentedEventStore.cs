using Amazon.XRay.Recorder.Core;
using EventStore;

namespace Api.Observability;

// Decorates the real event store so every append — including cascades (folder
// delete) and multi-append commands (action items) — emits EventsAppended and a
// stream/version log line, and so optimistic-concurrency failures are counted
// and logged in one place rather than in each command handler. Also wraps reads
// and appends in named X-Ray subsegments so the event-store boundary is visible
// in the trace (the underlying DynamoDB calls nest beneath them automatically).
public sealed class InstrumentedEventStore(
    IEventStore inner,
    IDomainMetrics metrics,
    ILogger<InstrumentedEventStore> logger) : IEventStore
{
    public async Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default)
    {
        AWSXRayRecorder.Instance.BeginSubsegment("ReadEvents");
        try
        {
            return await inner.ReadAsync(streamId, ct).ConfigureAwait(false);
        }
        finally
        {
            AWSXRayRecorder.Instance.EndSubsegment();
        }
    }

    // Not wrapped in a subsegment (unlike ReadAsync): this is the projection-rebuild
    // path, not part of a normal request trace.
    public Task<IReadOnlyList<EventEnvelope>> ReadAllStreamsAsync(CancellationToken ct = default) =>
        inner.ReadAllStreamsAsync(ct);

    public async Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        var aggregate = AggregateOf(streamId);
        AWSXRayRecorder.Instance.BeginSubsegment("AppendEvents");
        try
        {
            await inner.AppendAsync(streamId, expectedVersion, events, ct).ConfigureAwait(false);
            metrics.EventsAppended(aggregate, events.Count);
            logger.LogInformation("Events appended {StreamId} Version={Version} EventCount={Count}",
                streamId, expectedVersion + events.Count, events.Count);
        }
        catch (ConcurrencyException ex)
        {
            metrics.ConcurrencyConflict(aggregate);
            // {Reason} distinguishes a lost version-guard (ConditionalCheckFailed) from a concurrent
            // same-item transaction (TransactionConflict, BUG-28) — so prod can confirm the latter is
            // now retried, not 500ing.
            logger.LogWarning("Concurrency conflict {StreamId} ExpectedVersion={Expected} ActualVersion={Actual} Reason={Reason}",
                ex.StreamId, ex.ExpectedVersion, ex.ActualVersion, ex.Reason ?? "unknown");
            throw;
        }
        finally
        {
            AWSXRayRecorder.Instance.EndSubsegment();
        }
    }

    // Stream IDs are "<aggregate><delimiter><id>" where the delimiter is '#' (note,
    // todo, action) or '-' (folder). The prefix is the aggregate name.
    private static string AggregateOf(string streamId)
    {
        var idx = streamId.IndexOfAny(['#', '-']);
        var prefix = idx > 0 ? streamId[..idx] : streamId;
        return prefix.Length == 0 ? "Unknown" : char.ToUpperInvariant(prefix[0]) + prefix[1..];
    }
}
