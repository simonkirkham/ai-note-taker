using Domain;
using Domain.ActionItems;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Microsoft.Extensions.Logging;

namespace Api.Projections;

// The async projector's core engine, independent of the Lambda runtime so it is unit
// testable with in-memory stores. Given the set of stream ids that changed in a batch, it
// rebuilds each affected stream's read models via the shared ProjectionUpdater (the 27-A
// seam) — the same fold logic the write path runs inline, now driven off the event log.
//
// Lives in src/Api (not src/Projector) so the in-process hosts (test harness + local
// Kestrel) can wrap their event store with the sync decorator without src/Api referencing
// src/Projector (which would re-create the project cycle). The Projector Lambda references
// src/Api for this engine.
//
// Authoritative re-read, not the stream record's NEW_IMAGE: for each changed stream it
// re-reads the FULL stream and applies every event above the processed-position mark. This
// gives the re-fold projections (title/detail/search) the full history they need, makes a
// late/out-of-order record self-correct, and — with the position guard — makes the
// increment-based feedback counters redelivery-safe (the guarantee 27-A could not give).
public sealed class StreamProjector(
    IEventStore eventStore,
    IProjectionUpdater updater,
    IProcessedPositionStore positions,
    IProjectorMetrics metrics,
    ILogger<StreamProjector> logger)
{
    public async Task ProcessStreamsAsync(IEnumerable<string> changedStreamIds, CancellationToken ct = default)
    {
        foreach (var streamId in changedStreamIds.Distinct())
            await ProcessOneAsync(streamId, ct).ConfigureAwait(false);
    }

    private async Task ProcessOneAsync(string streamId, CancellationToken ct)
    {
        var full = await eventStore.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (full.Count == 0) return;

        var lastSeq = await positions.GetLastSeqAsync(streamId, ct).ConfigureAwait(false);
        var newEnvelopes = full.Where(e => e.SequenceNumber > lastSeq).ToList();
        if (newEnvelopes.Count == 0)
        {
            metrics.DuplicateSkipped();
            logger.LogInformation("Projector skip {StreamId} at {Version}: {Skipped}",
                streamId, lastSeq, "position_guard");
            return;
        }

        var history = full.Where(e => e.SequenceNumber <= lastSeq).ToList();
        if (!await RouteAsync(streamId, history, newEnvelopes, ct).ConfigureAwait(false))
            return;

        var maxSeq = newEnvelopes[^1].SequenceNumber;
        await positions.SetLastSeqAsync(streamId, maxSeq, ct).ConfigureAwait(false);

        var lagMs = (DateTimeOffset.UtcNow - newEnvelopes[^1].OccurredAt).TotalMilliseconds;
        metrics.Applied(newEnvelopes.Count);
        metrics.Lag(lagMs);
        logger.LogInformation("Projector applied {StreamId} to {Version} ({EventType}) lag {LagMs}ms",
            streamId, maxSeq, newEnvelopes[^1].EventType, lagMs);
    }

    // Returns false when the stream could not be routed (unknown prefix / missing anchor),
    // so the caller does not advance the position mark for an un-applied stream.
    private async Task<bool> RouteAsync(string streamId, IReadOnlyList<EventEnvelope> history, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        if (streamId.StartsWith("note#", StringComparison.Ordinal))
        {
            await updater.ApplyNoteEventsAsync(ParseNoteId(streamId), history, newEnvelopes, ct).ConfigureAwait(false);
            return true;
        }
        if (streamId.StartsWith("action#", StringComparison.Ordinal))
        {
            var added = history.Concat(newEnvelopes).FirstOrDefault(e => e.EventType == nameof(ActionItemAdded));
            if (added is null)
            {
                logger.LogWarning("Projector: action stream {StreamId} has no ActionItemAdded; skipping", streamId);
                return false;
            }
            var noteId = ((ActionItemAdded)EventDeserializer.Deserialize(added)).NoteId;
            await updater.ApplyActionItemEventsAsync(noteId, history, Deserialize(newEnvelopes), newEnvelopes, ct).ConfigureAwait(false);
            return true;
        }
        if (streamId.StartsWith("todo#", StringComparison.Ordinal))
        {
            await updater.ApplyTodoEventsAsync(Deserialize(newEnvelopes), newEnvelopes, ct).ConfigureAwait(false);
            return true;
        }
        if (streamId.StartsWith("folder-", StringComparison.Ordinal))
        {
            await updater.ApplyFolderEventsAsync(newEnvelopes, ct).ConfigureAwait(false);
            return true;
        }
        if (streamId.StartsWith("workspace-", StringComparison.Ordinal))
        {
            await updater.ApplyWorkspaceEventsAsync(newEnvelopes, ct).ConfigureAwait(false);
            return true;
        }

        logger.LogWarning("Projector: unknown stream prefix {StreamId}; skipping", streamId);
        return false;
    }

    private static NoteId ParseNoteId(string streamId) =>
        new(Guid.Parse(streamId["note#".Length..]));

    private static IReadOnlyList<IDomainEvent> Deserialize(IReadOnlyList<EventEnvelope> envelopes) =>
        envelopes.Select(EventDeserializer.Deserialize).ToList();
}
