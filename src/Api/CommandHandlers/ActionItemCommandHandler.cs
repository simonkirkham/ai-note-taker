using Domain;
using Domain.ActionItems;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.Exceptions;
using Api.Observability;
using Api.Utilities;

namespace Api.CommandHandlers;

public sealed class ActionItemCommandHandler(
    IEventStore store,
    INoteDetailStore noteDetailStore,
    ICurrentUser currentUser,
    IDomainMetrics metrics,
    ILogger<ActionItemCommandHandler> logger) : IActionItemCommandHandler
{
    public Task<ActionId> HandleAsync(AddActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(AddActionItem), "ActionItem", async () =>
        {
            var noteDetail = await noteDetailStore.GetAsync(cmd.NoteId, ct).ConfigureAwait(false);
            if (noteDetail is null)
                throw new NoteNotFoundException(cmd.NoteId);

            var streamId = cmd.ActionId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            var newEvents = RebuildAggregate(history).Handle(cmd);

            var envelopes = ToEnvelopes(streamId, newEvents);
            await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);

            return cmd.ActionId;
        });

    public Task HandleAsync(CompleteActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(CompleteActionItem), "ActionItem", () =>
            ExecuteAppendAsync(cmd.ActionId, cmd, ct));

    public Task HandleAsync(ReopenActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(ReopenActionItem), "ActionItem", () =>
            ExecuteAppendAsync(cmd.ActionId, cmd, ct));

    public Task HandleAsync(DeleteActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(DeleteActionItem), "ActionItem", () =>
            ExecuteAppendAsync(cmd.ActionId, cmd, ct));

    async Task ExecuteAppendAsync(ActionId actionId, ICommand command, CancellationToken ct)
    {
        var streamId = actionId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) throw new ActionItemNotFoundException(actionId);

        var newEvents = RebuildAggregate(history).Handle(command);
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
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
