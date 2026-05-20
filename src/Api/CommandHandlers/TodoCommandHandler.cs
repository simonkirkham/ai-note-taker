using Domain;
using Domain.Todos;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.Utilities;

namespace Api.CommandHandlers;

public sealed class TodoCommandHandler(
    IEventStore store,
    ITodoListStore todoListStore,
    ICurrentUser currentUser) : ITodoCommandHandler
{
    public async Task HandleAsync(AddTodo cmd, CancellationToken ct = default)
    {
        var streamId = cmd.TodoId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        var newEvents = RebuildAggregate(history).Handle(cmd);
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);

        if (newEvents[0] is TodoAdded e)
            await todoListStore.PutAsync(
                new TodoItem(e.TodoId.Value.ToString(), null, null, "todo",
                    e.Description, envelopes[0].OccurredAt, null, currentUser.UserId), ct).ConfigureAwait(false);
    }

    public async Task HandleAsync(CompleteTodo cmd, CancellationToken ct = default)
    {
        var newEvents = await ExecuteAndAppendAsync(cmd.TodoId, cmd, ct);
        if (newEvents[0] is TodoCompleted e)
            await todoListStore.UpdateCompletedAtAsync(cmd.TodoId.Value.ToString(), e.CompletedAt, ct).ConfigureAwait(false);
    }

    public async Task HandleAsync(ReopenTodo cmd, CancellationToken ct = default)
    {
        var newEvents = await ExecuteAndAppendAsync(cmd.TodoId, cmd, ct);
        if (newEvents[0] is TodoReopened)
            await todoListStore.UpdateCompletedAtAsync(cmd.TodoId.Value.ToString(), null, ct).ConfigureAwait(false);
    }

    public async Task HandleAsync(DeleteTodo cmd, CancellationToken ct = default)
    {
        var newEvents = await ExecuteAndAppendAsync(cmd.TodoId, cmd, ct);
        if (newEvents[0] is TodoDeleted)
            await todoListStore.DeleteAsync(cmd.TodoId.Value.ToString(), ct).ConfigureAwait(false);
    }

    async Task<IReadOnlyList<IDomainEvent>> ExecuteAndAppendAsync(TodoId todoId, ICommand command, CancellationToken ct)
    {
        var streamId = todoId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        var newEvents = RebuildAggregate(history).Handle(command);
        await store.AppendAsync(streamId, history.Count, ToEnvelopes(streamId, newEvents), ct).ConfigureAwait(false);
        return newEvents;
    }

    static Todo RebuildAggregate(IReadOnlyList<EventEnvelope> history)
    {
        var aggregate = new Todo();
        foreach (var e in history)
            aggregate.Apply(EventDeserializer.Deserialize(e));
        return aggregate;
    }

    List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        EventEnvelopeFactory.CreateEnvelopes(streamId, events, currentUser.UserId);
}
