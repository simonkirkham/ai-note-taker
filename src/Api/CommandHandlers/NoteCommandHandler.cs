using System.Text.Json;
using Domain;
using Domain.Notes;
using EventStore;
using Api.Auth;
using Api.Exceptions;
using Api.Observability;

namespace Api.CommandHandlers;

// Append-only since RYW-2: the whole Note aggregate is async — the projector (the in-process
// SyncProjectingEventStore decorator in tests/local, the Projector Lambda in prod) is the sole
// writer of the note read models, no inline ProjectionUpdater call. HandleAsync returns the new
// stream version (the write token) so the endpoint can surface it; the read side waits on
// proj-position before answering. The whole aggregate goes async at once (not flow-by-flow within
// the aggregate) so an async create never races an inline rename/tag on a not-yet-written row.
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
    // (BUG-17). A persistent conflict that survives the bounded attempts surfaces as a
    // RETRIABLE 503 (WriteContentionException), NOT a 409 — a 409 is the client's
    // duplicate/no-op signal and would silently drop the write (BUG-27); the client
    // retries the 503 until it lands. 6 attempts bounds worst-case added latency at
    // ~620ms on the interactive path (20/40/80/160/320ms exponential backoff + ≤20%
    // jitter before attempts 2-6; the final attempt throws without delaying).
    private const int MaxAppendAttempts = 6;
    private static readonly TimeSpan AppendRetryBaseDelay = TimeSpan.FromMilliseconds(20);

    public Task<long> HandleAsync(NoteCommand cmd, CancellationToken ct = default) =>
        Run(cmd, currentUser.UserId, currentWorkspace.WorkspaceId, currentUser.Name, ct);

    // Identity-explicit overload (33-B2): lets a non-HTTP caller (the TranscribeCompletion Lambda's
    // INoteAnalysisService) persist with an explicit owner/workspace instead of the scoped
    // ICurrentUser/ICurrentWorkspace. No display name (the Lambda has none) — the note's owner name
    // was stamped by the HTTP create. The HTTP path delegates with the scoped identity + name, so its
    // behaviour — and every existing test — is unchanged.
    public Task<long> HandleAsync(NoteCommand cmd, string userId, string? workspaceId, CancellationToken ct = default) =>
        Run(cmd, userId, workspaceId, userName: null, ct);

    // A no-append read of the stream's current version (Phase 38): the import flow appends across
    // several handler calls, so it reads the post-analysis version here for its consistency token.
    public async Task<long> GetCurrentVersionAsync(NoteId noteId, CancellationToken ct = default)
    {
        var history = await store.ReadAsync(noteId.ToStreamId(), ct).ConfigureAwait(false);
        return history.Count;
    }

    private Task<long> Run(NoteCommand cmd, string userId, string? workspaceId, string? userName, CancellationToken ct) =>
        CommandInstrumentation.RunAsync(metrics, logger, cmd.GetType().Name, "Note", () =>
            ExecuteAsync(cmd.NoteId, note => note.Handle(cmd), userId, workspaceId, userName, ct, mustExist: cmd.MustExist));

    private async Task<long> ExecuteAsync(NoteId noteId, Func<Note, IReadOnlyList<IDomainEvent>> handle,
        string userId, string? workspaceId, string? userName, CancellationToken ct, bool mustExist = true)
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
            // Authorize from the strongly-consistent event stream, NOT the async NoteDetail projection
            // — whose post-create lag (projector hasn't folded NoteCreated yet) made every note write
            // 404 right after create under load (the residual E2E flake). The owner is the UserId
            // stamped on the note's events; a non-null owner that isn't the caller is a 404 (don't leak
            // existence). A null owner is a legacy pre-Phase-8 single-user note → not enforced.
            if (mustExist && history.Count > 0 && history[0].Metadata.UserId is { } ownerId
                && ownerId != userId)
                throw new NoteNotFoundException(noteId);
            var newEvents = handle(note);
            // No-op command (e.g. a re-tag the aggregate ignored): nothing appended, so the write
            // token is the current version — a read carrying it waits on an already-applied mark.
            if (newEvents.Count == 0) return history.Count;

            var envelopes = ToEnvelopes(streamId, newEvents, userId, workspaceId, userName);
            try
            {
                await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
            }
            catch (ConcurrencyException) when (attempt < MaxAppendAttempts)
            {
                await DelayBeforeRetryAsync(attempt, ct).ConfigureAwait(false);
                continue;
            }
            catch (ConcurrencyException ex)
            {
                // Retry budget exhausted: persistent write contention (concurrent writers to this
                // stream, e.g. a space-separated multi-tag add). Surface as a retriable 503 via
                // WriteContentionException — never the raw ConcurrencyException (→ 409), which the
                // client treats as a duplicate/no-op and would silently drop this write (BUG-27).
                throw new WriteContentionException(streamId, ex);
            }
            // Append-only: the projector (sync decorator in-process, Projector Lambda in prod) is
            // the sole writer of the note read models. The new stream version is the write token.
            return history.Count + envelopes.Count;
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

    private static List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events, string userId, string? workspaceId, string? userName) =>
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
                Metadata: new EventMetadata(Guid.NewGuid(), userId, null, null, workspaceId, userName));
        }).ToList();
}
