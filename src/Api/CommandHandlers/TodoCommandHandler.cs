using Domain;
using Domain.Todos;
using EventStore;
using Api.Auth;
using Api.Observability;
using Api.Utilities;

namespace Api.CommandHandlers;

public sealed class TodoCommandHandler(
    IEventStore store,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    IDomainMetrics metrics,
    ILogger<TodoCommandHandler> logger) : ITodoCommandHandler
{
    public Task HandleAsync(AddTodo cmd, CancellationToken ct = default) =>
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

    async Task ExecuteAppendAsync(TodoId todoId, ICommand command, CancellationToken ct)
    {
        var streamId = todoId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        var newEvents = RebuildAggregate(history).Handle(command);
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
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
