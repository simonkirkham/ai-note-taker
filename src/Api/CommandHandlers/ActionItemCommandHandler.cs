using Domain;
using Domain.ActionItems;
using Domain.Notes;
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
    INoteActionsStore noteActionsStore,
    ITodoListStore todoListStore,
    INoteCardListStore noteCardListStore,
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

            foreach (var (domainEvent, envelope) in newEvents.Zip(envelopes))
            {
                if (domainEvent is ActionItemAdded e)
                {
                    var action = new NoteAction(e.ActionId, e.Description, false, envelope.OccurredAt, null);
                    await noteActionsStore.UpsertAsync(cmd.NoteId, action, ct).ConfigureAwait(false);
                    await todoListStore.PutAsync(
                        new TodoItem(e.ActionId.Value.ToString(), e.NoteId.Value.ToString(), noteDetail.Title,
                            "action", e.Description, envelope.OccurredAt, null, currentUser.UserId), ct).ConfigureAwait(false);
                    await UpdateCardActionItemsAsync(cmd.NoteId,
                        items => items.Append(new NoteCardActionItem(e.ActionId, e.Description, false)).ToList().AsReadOnly(),
                        envelope.OccurredAt, ct).ConfigureAwait(false);
                }
            }

            return cmd.ActionId;
        });

    public Task HandleAsync(CompleteActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(CompleteActionItem), "ActionItem", async () =>
        {
            var (addedEvent, addedEnvelope, newEvents, newEnvelopes) = await ExecuteAndAppendAsync(cmd.ActionId, cmd, ct);
            foreach (var (domainEvent, envelope) in newEvents.Zip(newEnvelopes))
                if (domainEvent is ActionItemCompleted e)
                {
                    await noteActionsStore.UpsertAsync(addedEvent.NoteId,
                        new NoteAction(e.ActionId, addedEvent.Description, true, addedEnvelope.OccurredAt, e.CompletedAt), ct).ConfigureAwait(false);
                    await todoListStore.UpdateCompletedAtAsync(cmd.ActionId.Value.ToString(), e.CompletedAt, ct).ConfigureAwait(false);
                    await UpdateCardActionItemsAsync(addedEvent.NoteId,
                        items => items.Select(a => a.ActionId == e.ActionId ? a with { Completed = true } : a).ToList().AsReadOnly(),
                        envelope.OccurredAt, ct).ConfigureAwait(false);
                }
        });

    public Task HandleAsync(ReopenActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(ReopenActionItem), "ActionItem", async () =>
        {
            var (addedEvent, addedEnvelope, newEvents, newEnvelopes) = await ExecuteAndAppendAsync(cmd.ActionId, cmd, ct);
            foreach (var (domainEvent, envelope) in newEvents.Zip(newEnvelopes))
                if (domainEvent is ActionItemReopened)
                {
                    await noteActionsStore.UpsertAsync(addedEvent.NoteId,
                        new NoteAction(cmd.ActionId, addedEvent.Description, false, addedEnvelope.OccurredAt, null), ct).ConfigureAwait(false);
                    await todoListStore.UpdateCompletedAtAsync(cmd.ActionId.Value.ToString(), null, ct).ConfigureAwait(false);
                    await UpdateCardActionItemsAsync(addedEvent.NoteId,
                        items => items.Select(a => a.ActionId == cmd.ActionId ? a with { Completed = false } : a).ToList().AsReadOnly(),
                        envelope.OccurredAt, ct).ConfigureAwait(false);
                }
        });

    public Task HandleAsync(DeleteActionItem cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(DeleteActionItem), "ActionItem", async () =>
        {
            var (addedEvent, _, newEvents, newEnvelopes) = await ExecuteAndAppendAsync(cmd.ActionId, cmd, ct);
            foreach (var (domainEvent, envelope) in newEvents.Zip(newEnvelopes))
                if (domainEvent is ActionItemDeleted)
                {
                    await noteActionsStore.DeleteAsync(addedEvent.NoteId, cmd.ActionId, ct).ConfigureAwait(false);
                    await todoListStore.DeleteAsync(cmd.ActionId.Value.ToString(), ct).ConfigureAwait(false);
                    await UpdateCardActionItemsAsync(addedEvent.NoteId,
                        items => items.Where(a => a.ActionId != cmd.ActionId).ToList().AsReadOnly(),
                        envelope.OccurredAt, ct).ConfigureAwait(false);
                }
        });

    async Task UpdateCardActionItemsAsync(NoteId noteId,
        Func<IReadOnlyList<NoteCardActionItem>, IReadOnlyList<NoteCardActionItem>> update,
        DateTimeOffset occurredAt,
        CancellationToken ct)
    {
        var card = await noteCardListStore.GetByNoteAsync(noteId, ct).ConfigureAwait(false);
        if (card is { Deleted: false })
            await noteCardListStore.UpsertAsync(
                card with { ActionItems = update(card.ActionItems), LastModifiedAt = occurredAt }, ct).ConfigureAwait(false);
    }

    async Task<(ActionItemAdded AddedEvent, EventEnvelope AddedEnvelope, IReadOnlyList<IDomainEvent> NewEvents, List<EventEnvelope> NewEnvelopes)>
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

        return (addedEvent, addedEnvelope, newEvents, envelopes);
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
