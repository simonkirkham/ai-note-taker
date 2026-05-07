using System.Text.Json;
using Domain;
using Domain.ActionItems;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class ActionItemNotFoundException(ActionId actionId)
    : Exception($"Action item {actionId} not found.");

public sealed class ActionItemCommandHandler(
    IEventStore store,
    INoteDetailStore noteDetailStore,
    INoteActionsStore noteActionsStore,
    ITodoListStore todoListStore)
{
    public async Task<ActionId> HandleAsync(AddActionItem cmd, CancellationToken ct = default)
    {
        var noteDetail = await noteDetailStore.GetAsync(cmd.NoteId, ct).ConfigureAwait(false);
        if (noteDetail is null)
            throw new NoteNotFoundException(cmd.NoteId);

        var streamId = cmd.ActionId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        var newEvents = RebuildAggregate(history).Handle(cmd);

        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);

        foreach (var (domainEvent, envelope) in newEvents.Zip(envelopes))
        {
            if (domainEvent is ActionItemAdded e)
            {
                var action = new NoteAction(e.ActionId, e.Description, false, envelope.OccurredAt, null);
                await noteActionsStore.UpsertAsync(cmd.NoteId, action, ct).ConfigureAwait(false);
                await todoListStore.PutAsync(
                    new TodoItem(e.ActionId, e.NoteId, noteDetail.Title, e.Description, envelope.OccurredAt), ct).ConfigureAwait(false);
            }
        }

        return cmd.ActionId;
    }

    public async Task HandleAsync(CompleteActionItem cmd, CancellationToken ct = default)
    {
        var (addedEvent, addedEnvelope, newEvents) = await ExecuteAndAppendAsync(cmd.ActionId, cmd, ct);
        foreach (var domainEvent in newEvents)
            if (domainEvent is ActionItemCompleted e)
            {
                await noteActionsStore.UpsertAsync(addedEvent.NoteId,
                    new NoteAction(e.ActionId, addedEvent.Description, true, addedEnvelope.OccurredAt, e.CompletedAt), ct).ConfigureAwait(false);
                await todoListStore.DeleteAsync(cmd.ActionId, ct).ConfigureAwait(false);
            }
    }

    public async Task HandleAsync(ReopenActionItem cmd, CancellationToken ct = default)
    {
        var (addedEvent, addedEnvelope, newEvents) = await ExecuteAndAppendAsync(cmd.ActionId, cmd, ct);
        foreach (var domainEvent in newEvents)
            if (domainEvent is ActionItemReopened)
            {
                await noteActionsStore.UpsertAsync(addedEvent.NoteId,
                    new NoteAction(cmd.ActionId, addedEvent.Description, false, addedEnvelope.OccurredAt, null), ct).ConfigureAwait(false);
                var noteDetail = await noteDetailStore.GetAsync(addedEvent.NoteId, ct).ConfigureAwait(false);
                await todoListStore.PutAsync(
                    new TodoItem(cmd.ActionId, addedEvent.NoteId, noteDetail?.Title ?? string.Empty,
                        addedEvent.Description, addedEnvelope.OccurredAt), ct).ConfigureAwait(false);
            }
    }

    async Task<(ActionItemAdded AddedEvent, EventEnvelope AddedEnvelope, IReadOnlyList<IDomainEvent> NewEvents)>
        ExecuteAndAppendAsync(ActionId actionId, ICommand command, CancellationToken ct)
    {
        var streamId = actionId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) throw new ActionItemNotFoundException(actionId);

        var addedEnvelope = history.First(e => e.EventType == nameof(ActionItemAdded));
        var addedEvent = (ActionItemAdded)EventDeserializer.Deserialize(addedEnvelope);

        var newEvents = RebuildAggregate(history).Handle(command);
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);

        return (addedEvent, addedEnvelope, newEvents);
    }

    static ActionItem RebuildAggregate(IReadOnlyList<EventEnvelope> history)
    {
        var aggregate = new ActionItem();
        foreach (var e in history)
            aggregate.Apply(EventDeserializer.Deserialize(e));
        return aggregate;
    }

    static List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        events.Select(e => new EventEnvelope(
            StreamId: streamId, SequenceNumber: 0,
            EventType: e.GetType().Name, EventVersion: 1,
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: JsonSerializer.Serialize(e, e.GetType()),
            Metadata: new EventMetadata(Guid.NewGuid(), null, null, null)))
        .ToList();
}
