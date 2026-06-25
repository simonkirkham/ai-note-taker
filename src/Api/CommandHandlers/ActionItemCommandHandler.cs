using Domain;
using Domain.ActionItems;
using EventStore;
using Api.Auth;
using Api.Exceptions;
using Api.Observability;
using Api.Utilities;

namespace Api.CommandHandlers;

// Append-only since RYW-3a: the whole ActionItem aggregate is async — the projector (the in-process
// SyncProjectingEventStore decorator in tests/local, the Projector Lambda in prod) is the sole
// writer of the action read models, no inline ProjectionUpdater call. HandleAsync returns the new
// stream version (the write token) so the endpoint can surface it; the read side waits on
// proj-position before answering.
//
// Removing the inline write also CLOSES a latent prod double-count: the Projector Lambda already
// processed action# streams, so on every complete/delete BOTH the inline path and the projector ran
// ApplyActionItemEventsAsync, and the feedback counter (an unconditional DynamoDB `ADD`, NOT
// idempotent) was incremented twice. With the projector now the sole writer it increments once.
// (The remaining feedback double-count — AI-suggestion counters on the still-inline analysis flow —
// closes in RYW-3c.)
//
// No ConcurrencyException retry loop here (unlike the sibling NoteCommandHandler, which added one
// for the multi-tag race, BUG-17): concurrent writes to a single action stream are near-impossible
// in a single-user app, so a persistent conflict simply surfaces as a 409. Deferred deliberately.
public sealed class ActionItemCommandHandler(
    IEventStore store,
    ICurrentUser currentUser,
    IDomainMetrics metrics,
    ILogger<ActionItemCommandHandler> logger) : IActionItemCommandHandler
{
    public Task<long> HandleAsync(AddActionItem cmd, CancellationToken ct = default) =>
        HandleAsync(cmd, currentUser.UserId, ct);

    // Identity-explicit overload (33-B2): the TranscribeCompletion Lambda's analysis re-run adds AI
    // action items with no scoped ICurrentUser. Action-item events carry only UserId (workspace is
    // transitive via the parent note — view-schemas), so just the owner is threaded. The HTTP
    // overload delegates here with the scoped identity, leaving existing behaviour unchanged.
    public Task<long> HandleAsync(AddActionItem cmd, string userId, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(AddActionItem), "ActionItem", async () =>
        {
            // Note existence is a strongly-consistent decision — read the note's EVENT STREAM
            // (ConsistentRead), never the async NoteDetail projection. The projection lags right after
            // a note is created, so an action added immediately after create raced it to a spurious
            // NoteNotFoundException → 404 → the action was never written (the residual
            // ActionReadYourWrites deploy-gate flake; root-caused via test-env logs, TI-39). The
            // endpoint also authorizes ownership against the event stream (NoteAuthorizer); this is the
            // handler's own existence guard, kept strongly consistent for the same reason.
            var noteHistory = await store.ReadAsync(cmd.NoteId.ToStreamId(), ct).ConfigureAwait(false);
            if (noteHistory.Count == 0)
                throw new NoteNotFoundException(cmd.NoteId);

            var streamId = cmd.ActionId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            var newEvents = RebuildAggregate(history).Handle(cmd);

            var envelopes = EventEnvelopeFactory.CreateEnvelopes(streamId, newEvents, userId);
            await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
            return (long)(history.Count + envelopes.Count);
        });

    public Task<long> HandleAsync(CompleteActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(CompleteActionItem), "ActionItem", () =>
            ExecuteAppendAsync(cmd.ActionId, cmd, ct));

    public Task<long> HandleAsync(ReopenActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(ReopenActionItem), "ActionItem", () =>
            ExecuteAppendAsync(cmd.ActionId, cmd, ct));

    public Task<long> HandleAsync(EditActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(EditActionItem), "ActionItem", () =>
            ExecuteAppendAsync(cmd.ActionId, cmd, ct));

    public Task<long> HandleAsync(DeleteActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(DeleteActionItem), "ActionItem", () =>
            ExecuteAppendAsync(cmd.ActionId, cmd, ct));

    async Task<long> ExecuteAppendAsync(ActionId actionId, ICommand command, CancellationToken ct)
    {
        var streamId = actionId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) throw new ActionItemNotFoundException(actionId);

        var newEvents = RebuildAggregate(history).Handle(command);
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        return history.Count + envelopes.Count;
    }

    static ActionItem RebuildAggregate(IReadOnlyList<EventEnvelope> history)
    {
        var aggregate = new ActionItem();
        foreach (var e in history)
            aggregate.Apply(EventDeserializer.Deserialize(e));
        return aggregate;
    }

    List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        EventEnvelopeFactory.CreateEnvelopes(streamId, events, currentUser.UserId);
}
