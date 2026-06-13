using EventStore;

namespace Api.Projections;

// In-process IEventStore decorator: after a successful append to a MIGRATED stream it drives the
// SAME StreamProjector that runs async off the DynamoDB stream in prod, so the in-process hosts
// (the ApiFactory test harness + local Kestrel) get immediate read-after-write consistency
// through the production projection code path with no inline projection write.
//
// Scoped to migrated stream prefixes (RYW-1: `todo#`; RYW-2 adds `note#`; RYW-3a adds `action#`;
// RYW-3b adds `folder-`/`workspace-`). The migration is incremental — only migrated flows have had
// their inline write removed. For the remaining OTHER flow (analysis) the command handler still
// projects inline in-process,
// so the decorator must NOT also project those streams or every read model would be written twice
// per request. Most read-model writes are idempotent upserts, but the AI-suggestion feedback
// counters are unconditional DynamoDB `ADD`s (NOT idempotent), so on the still-inline analysis flow
// a second in-process write would be a hard double-count (in prod the Projector Lambda already
// double-writes that flow — the transient over-count RYW-3c closes). As each flow migrates it joins
// MigratedPrefixes and its inline write is removed.
//
// NEVER wired in the deployed API Lambda: there the stream + Projector Lambda do projections
// asynchronously for ALL streams, and the API has no projection grants.
public sealed class SyncProjectingEventStore(IEventStore inner, StreamProjector projector) : IEventStore
{
    // Stream prefixes whose inline projection write has been removed (so the projector is their
    // sole in-process writer). Grows as flows migrate.
    private static readonly string[] MigratedPrefixes = ["todo#", "note#", "action#", "folder-", "workspace-"];

    public async Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        await inner.AppendAsync(streamId, expectedVersion, events, ct).ConfigureAwait(false);

        if (!MigratedPrefixes.Any(p => streamId.StartsWith(p, StringComparison.Ordinal)))
            return;

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
