using System.Text.Json;
using Domain;
using Domain.Notes;
using EventStore;
using Api.Auth;
using Api.Exceptions;
using Api.Observability;

namespace Api.CommandHandlers;

public sealed class NoteCommandHandler(
    IEventStore store,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    IDomainMetrics metrics,
    ILogger<NoteCommandHandler> logger) : INoteCommandHandler
{
    private const int InitialEventVersion = 1;

    // A benign concurrency race (two fast writes to the same note stream, e.g. a
    // space-separated multi-tag paste) makes the second append lose the optimistic-
    // concurrency check. The aggregate is pure and these commands are idempotent on a
    // fresh version (TagNote 409s a duplicate, UntagNote 404s a missing tag), so re-read,
    // re-run, re-append resolves the race transparently instead of dropping the write
    // (BUG-17). A persistent conflict still surfaces after the bounded attempts (→ 409).
    // 4 attempts bounds worst-case added latency at ~170ms on the interactive request
    // path (20/40/80ms exponential backoff + ≤20% jitter before attempts 2/3/4; the
    // final attempt rethrows without delaying). Raising this materially raises that bound.
    private const int MaxAppendAttempts = 4;
    private static readonly TimeSpan AppendRetryBaseDelay = TimeSpan.FromMilliseconds(20);

    public Task<NoteId> HandleAsync(NoteCommand cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, cmd.GetType().Name, "Note", async () =>
        {
            await ExecuteAsync(cmd.NoteId, note => note.Handle(cmd), ct, mustExist: cmd.MustExist).ConfigureAwait(false);
            return cmd.NoteId;
        });

    private async Task ExecuteAsync(NoteId noteId, Func<Note, IReadOnlyList<IDomainEvent>> handle, CancellationToken ct,
        bool mustExist = true)
    {
        var streamId = noteId.ToStreamId();
        // Read → rebuild → handle → append is retried as a unit: each attempt re-reads
        // the stream so the pure aggregate runs against the latest version, and the
        // append targets that fresh expected version. Only ConcurrencyException is
        // retried; any other failure (or an exhausted budget) propagates unchanged.
        for (var attempt = 1; ; attempt++)
        {
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            var note = Rebuild(history);
            // Covers both a never-created note (empty stream) and a deleted one whose
            // stream still exists: either way the aggregate is gone, so the write is a
            // 404 rather than a domain InvalidOperationException that escapes as a 500.
            if (mustExist && !note.Exists) throw new NoteNotFoundException(noteId);
            var newEvents = handle(note);
            if (newEvents.Count == 0) return;

            var envelopes = ToEnvelopes(streamId, newEvents, currentUser.UserId, currentWorkspace.WorkspaceId);
            try
            {
                await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
            }
            catch (ConcurrencyException) when (attempt < MaxAppendAttempts)
            {
                await DelayBeforeRetryAsync(attempt, ct).ConfigureAwait(false);
                continue;
            }
            return;
        }
    }

    private static Task DelayBeforeRetryAsync(int attempt, CancellationToken ct)
    {
        var backoff = AppendRetryBaseDelay.TotalMilliseconds * Math.Pow(2, attempt - 1);
        var jitter = Random.Shared.NextDouble() * backoff * 0.2;
        return Task.Delay(TimeSpan.FromMilliseconds(backoff + jitter), ct);
    }

    private static Note Rebuild(IReadOnlyList<EventEnvelope> history)
    {
        var note = new Note();
        foreach (var e in history)
            note.Apply(EventDeserializer.Deserialize(e));
        return note;
    }

    private static List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events, string userId, string? workspaceId) =>
        events.Select(e =>
        {
            // Versioned events are persisted under their logical (v1) EventType name with a bumped
            // EventVersion, so a stream's history reads as one type across versions. The aggregate emits
            // ContentEdited but it is stored as ContentEditedV2; the V2 suggestion events (10-M) carry
            // their own shape but persist under the TagsSuggested/ActionItemsSuggested names at version 2.
            var (type, version, payload) = e switch
            {
                ContentEdited ce => (nameof(ContentEdited), 2, JsonSerializer.Serialize(
                    new ContentEditedV2(ce.NoteId, ce.NewContent, ce.NewContent.Length))),
                TagsSuggestedV2 => (nameof(TagsSuggested), 2, JsonSerializer.Serialize(e, e.GetType())),
                ActionItemsSuggestedV2 => (nameof(ActionItemsSuggested), 2, JsonSerializer.Serialize(e, e.GetType())),
                _ => (e.GetType().Name, InitialEventVersion, JsonSerializer.Serialize(e, e.GetType()))
            };

            return new EventEnvelope(
                StreamId: streamId, SequenceNumber: 0, EventType: type, EventVersion: version,
                OccurredAt: DateTimeOffset.UtcNow, Payload: payload,
                Metadata: new EventMetadata(Guid.NewGuid(), userId, null, null, workspaceId));
        }).ToList();
}
