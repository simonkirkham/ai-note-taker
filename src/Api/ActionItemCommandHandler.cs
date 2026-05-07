using System.Text.Json;
using Domain;
using Domain.ActionItems;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class ActionItemCommandHandler(
    IEventStore store,
    INoteDetailStore noteDetailStore,
    INoteActionsStore noteActionsStore)
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
            }
        }

        return cmd.ActionId;
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
