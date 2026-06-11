using EventStore;

namespace Api.Projections;

// In-process IEventStore decorator: after a successful append it drives the SAME
// StreamProjector that runs async off the DynamoDB stream in prod, so the in-process hosts
// (the ApiFactory test harness + local Kestrel) get immediate read-after-write consistency
// through the production projection code path — no inline projection writes in the handlers.
//
// NEVER wired in the deployed API Lambda: there the stream + Projector Lambda do projections
// asynchronously, and the API has no projection grants. The inline path is gone, so this
// decorator and the projector are the sole read-model writers; they must not both run for a
// given host or feedback counters would double-count.
public sealed class SyncProjectingEventStore(IEventStore inner, StreamProjector projector) : IEventStore
{
    public async Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        await inner.AppendAsync(streamId, expectedVersion, events, ct).ConfigureAwait(false);
        // Deliberately not isolated: a projector fault here surfaces as a 500 on the in-process
        // request (the append already committed). That is the right behaviour for tests/local —
        // it makes a projection bug loud — and mirrors that in prod the append succeeds and the
        // async projector handles (and DLQs) failures out of band.
        await projector.ProcessStreamsAsync([streamId], ct).ConfigureAwait(false);
    }

    public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default) =>
        inner.ReadAsync(streamId, ct);

    public Task<IReadOnlyList<EventEnvelope>> ReadAllStreamsAsync(CancellationToken ct = default) =>
        inner.ReadAllStreamsAsync(ct);
}
