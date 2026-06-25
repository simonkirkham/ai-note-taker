using EventStore;

namespace Api.Projections;

// In-process IEventStore decorator: after a successful append to a MIGRATED stream it drives the
// SAME StreamProjector that runs async off the DynamoDB stream in prod, so the in-process hosts
// (the ApiFactory test harness + local Kestrel) get immediate read-after-write consistency
// through the production projection code path with no inline projection write.
//
// Scoped to migrated stream prefixes (RYW-1: `todo#`; RYW-2: `note#`; RYW-3a: `action#`;
// RYW-3b: `folder-`/`workspace-`). As of RYW-3b ALL projected stream types are migrated — every
// command handler is append-only, so the projector (this decorator in-process, the Projector
// Lambda in prod) is the sole writer of every read model. The AI-analysis flow needed no separate
// migration: its events ride the already-migrated `note#`/`action#` streams (RYW-2/3a), so removing
// those inline writes already made the projector the sole writer of the suggestion-feedback
// counters — closing the transient double-count the non-idempotent `ADD` would otherwise cause when
// both an inline write and the projector ran (pinned by an exactly-once test, RYW-3c).
//
// The prefix list stays a guard: a NEW flow added later must join it the moment its inline write is
// removed, or its read models won't update in the in-process hosts. While any flow were still inline
// the decorator must NOT project its streams, or the non-idempotent feedback `ADD` would double in
// tests — but no such flow remains.
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
