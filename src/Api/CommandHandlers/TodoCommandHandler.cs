using Domain;
using Domain.Todos;
using EventStore;
using Api.Auth;
using Api.Observability;
using Api.Utilities;

namespace Api.CommandHandlers;

// Append-only since RYW-1: the whole Todo aggregate is async — the projector (sync decorator
// in-process, the Projector Lambda in prod) is the sole writer of the TodoList read model, no
// inline ProjectionUpdater call. AddTodo surfaces the new stream version (the write token) so
// the endpoint can return it; the read side waits on proj-position before answering. The whole
// aggregate (not just TodoAdded) goes async to stay internally consistent — an async add with an
// inline complete/reopen/delete would race a not-yet-written row.
public sealed class TodoCommandHandler(
    IEventStore store,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    IDomainMetrics metrics,
    ILogger<TodoCommandHandler> logger) : ITodoCommandHandler
{
    public Task<long> HandleAsync(AddTodo cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(AddTodo), "Todo", () =>
            ExecuteAppendAsync(cmd.TodoId, cmd, ct));

    public Task HandleAsync(CompleteTodo cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(CompleteTodo), "Todo", () =>
            ExecuteAppendAsync(cmd.TodoId, cmd, ct));

    public Task HandleAsync(ReopenTodo cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(ReopenTodo), "Todo", () =>
            ExecuteAppendAsync(cmd.TodoId, cmd, ct));

    public Task HandleAsync(DeleteTodo cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(DeleteTodo), "Todo", () =>
            ExecuteAppendAsync(cmd.TodoId, cmd, ct));

    async Task<long> ExecuteAppendAsync(TodoId todoId, ICommand command, CancellationToken ct)
    {
        var streamId = todoId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        var newEvents = RebuildAggregate(history).Handle(command);
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        return history.Count + envelopes.Count;
    }

    static Todo RebuildAggregate(IReadOnlyList<EventEnvelope> history)
    {
        var aggregate = new Todo();
        foreach (var e in history)
            aggregate.Apply(EventDeserializer.Deserialize(e));
        return aggregate;
    }

    List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        EventEnvelopeFactory.CreateEnvelopes(streamId, events, currentUser.UserId, currentWorkspace.WorkspaceId);
}
